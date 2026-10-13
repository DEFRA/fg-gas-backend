import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { db } from "../../common/mongo-client.js";
import { Outbox, OutboxStatus } from "../models/outbox.js";
import {
  claimEvents,
  deadLetterEvent,
  editPayloadById,
  findById,
  findEditableById,
  findNextMessage,
  findStatusById,
  insertMany,
  purgeById,
  redriveById,
  update,
  updateDeadEvents,
  updateExpiredEvents,
  updateFailedEvents,
  updateResubmittedEvents,
} from "./outbox.repository.js";
import { STAMPED_FIELDS } from "../stamps.js";

vi.mock("../../common/mongo-client.js");

const MAX_TIME = { maxTimeMS: config.adminReadTimeoutMs };

describe("outbox.repository", () => {
  describe("deadLetterRecord", () => {
    it("should DLQ a given record", async () => {
      const mockUpdateOne = vi.fn().mockResolvedValueOnce({
        modifiedCount: 1,
      });
      db.collection.mockReturnValue({
        updateOne: mockUpdateOne,
      });

      const record = {
        _id: "12345",
      };

      await deadLetterEvent(record);

      expect(mockUpdateOne).toHaveBeenCalledWith(
        {
          _id: record._id,
        },
        {
          $set: {
            status: OutboxStatus.DEAD_LETTER,
            claimedAt: null,
            claimExpiresAt: null,
            claimedBy: null,
          },
        },
      );
    });
  });

  describe("findNextMessage", () => {
    it("should return a document when one is available", async () => {
      const mockDocument = {
        _id: "1234",
        status: OutboxStatus.PUBLISHED,
        segregationRef: "ref_1",
      };
      const findOne = vi.fn().mockResolvedValue(mockDocument);
      db.collection.mockReturnValue({ findOne });

      const result = await findNextMessage(["locked_ref"]);

      expect(result).toEqual(mockDocument);
      expect(findOne).toHaveBeenCalledWith(
        {
          status: OutboxStatus.PUBLISHED,
          claimedBy: null,
          completionAttempts: { $lt: config.outbox.outboxMaxRetries },
          segregationRef: { $nin: ["locked_ref"] },
        },
        { sort: { publicationDate: 1 } },
      );
    });

    it("should return null when no document is found", async () => {
      const findOne = vi.fn().mockResolvedValue(null);
      db.collection.mockReturnValue({ findOne });
      vi.spyOn(logger, "info");

      const result = await findNextMessage(["ref_1", "ref_2"]);

      expect(result).toBeNull();
    });
  });

  describe("insertMany", () => {
    it("should insert events", async () => {
      const mockInsertMany = vi.fn().mockResolvedValueOnce({
        modifiedCount: 1,
      });
      db.collection.mockReturnValue({
        insertMany: mockInsertMany,
      });

      const events = [
        new Outbox({
          target: "arn:some:arn:value",
          event: {
            clientRef: "1234-7778",
          },
          segregationRef: "seg-ref-1",
        }),
        new Outbox({
          target: "arn:some:other:value",
          event: {
            clientRef: "0987-1234",
          },
          segregationRef: "seg-ref-2",
        }),
      ];

      const mockSession = vi.fn();

      await insertMany(events, mockSession);

      expect(mockInsertMany).toHaveBeenCalledWith(
        events.map((event) => ({ ...event, errorKey: null })),
        { session: mockSession },
      );
    });
  });

  describe("claimEvents", () => {
    it("should fetch any pending events", async () => {
      const claimedBy = randomUUID();
      const mockDocument = {
        _id: "1234",
        publicationDate: new Date(),
        target: "arn:an:arn:value",
        event: {
          clientRef: "1234-5668",
        },
        completionAttempts: 1,
        status: OutboxStatus.PUBLISHED,
        segregationRef: "seg-ref-1",
      };
      const findOneAndUpdateMock = vi.fn();
      findOneAndUpdateMock
        .mockResolvedValueOnce(mockDocument)
        .mockResolvedValueOnce(null);

      db.collection.mockReturnValue({ findOneAndUpdate: findOneAndUpdateMock });

      const results = await claimEvents(claimedBy);
      expect(results[0]).toBeInstanceOf(Outbox);
      expect(results).toHaveLength(1);
    });
  });

  describe("update", () => {
    it("calls updateOne", async () => {
      const mockUpdate = vi.fn();
      db.collection.mockReturnValue({
        updateOne: mockUpdate,
      });
      const claimedBy = randomUUID();
      const _id = randomUUID();
      const event = {};

      const outboxEvent = new Outbox({
        _id,
        event,
        publicationDate: new Date(),
        target: "arn:foo:bar",
        completionAttempts: 1,
        status: OutboxStatus.PROCESSING,
        segregationRef: "seg-ref-1",
      });

      await update(outboxEvent, claimedBy);
      expect(mockUpdate).toHaveBeenCalledWith(
        {
          _id,
          claimedBy,
        },
        {
          $set: {
            claimExpiresAt: null,
            claimedAt: null,
            claimedBy: null,
            completionAttempts: 1,
            completionDate: undefined,
            expireAt: null,
            event: {},
            lastResubmissionDate: undefined,
            lastError: null,
            errorKey: null,
            attemptHistory: [],
            lastRedrive: null,
            publicationDate: expect.any(Date),
            segregationRef: "seg-ref-1",
            status: "PROCESSING",
            target: "arn:foo:bar",
          },
        },
      );
    });

    it("never sends the stamps back, so a stale copy cannot overwrite them", async () => {
      const mockUpdate = vi.fn();
      db.collection.mockReturnValue({ updateOne: mockUpdate });

      await update(
        Outbox.createMock({
          eventType: "case.create",
          refs: ["ref:abc-123"],
        }),
        randomUUID(),
      );

      const sent = Object.keys(mockUpdate.mock.calls[0][1].$set);

      expect(sent.filter((key) => STAMPED_FIELDS.includes(key))).toEqual([]);
      expect(sent).toContain("status");
    });
  });

  describe("updateExpiredEvents", () => {
    it("should call updateMany", async () => {
      const updateMany = vi.fn().mockResolvedValue({});
      db.collection.mockReturnValue({
        updateMany,
      });

      await updateExpiredEvents();

      expect(updateMany).toHaveBeenCalledWith(
        {
          claimExpiresAt: {
            $lt: expect.any(Date),
          },
          status: {
            $nin: [
              OutboxStatus.DEAD_LETTER,
              OutboxStatus.COMPLETED,
              OutboxStatus.PURGED,
            ],
          },
        },
        {
          $set: {
            status: OutboxStatus.FAILED,
            lastError: {
              name: "ClaimExpired",
              message: "claim expired before completion",
              at: expect.any(String),
            },
            errorKey: "ClaimExpired: claim expired before completion",
            claimedAt: null,
            claimedBy: null,
            claimExpiresAt: null,
          },
          $inc: { completionAttempts: 1 },
          $push: {
            attemptHistory: {
              $each: [
                {
                  at: expect.any(String),
                  name: "ClaimExpired",
                  message: "claim expired before completion",
                  stack: null,
                },
              ],
              $slice: -10,
            },
          },
        },
      );
    });
  });

  describe("updateFailedEvents", () => {
    it("should call updateMany", async () => {
      const updateMany = vi.fn().mockResolvedValue({});
      db.collection.mockReturnValue({
        updateMany,
      });

      await updateFailedEvents();

      expect(updateMany).toHaveBeenCalledWith(
        {
          status: OutboxStatus.FAILED,
        },
        {
          $set: {
            status: OutboxStatus.RESUBMITTED,
            claimedAt: null,
            claimedBy: null,
            claimExpiresAt: null,
          },
        },
      );
    });
  });

  describe("updateResubmittedEvents", () => {
    it("should call updateMany", async () => {
      const updateMany = vi.fn().mockResolvedValue({});
      db.collection.mockReturnValue({
        updateMany,
      });
      await updateResubmittedEvents();

      expect(updateMany).toHaveBeenCalledWith(
        {
          status: OutboxStatus.RESUBMITTED,
        },
        {
          $set: {
            status: OutboxStatus.PUBLISHED,
            claimedAt: null,
            claimExpiresAt: null,
            claimedBy: null,
          },
        },
      );
    });
  });

  describe("updateDeadEvents", () => {
    it("should call updateMany", async () => {
      const MAX_RETRIES = config.outbox.outboxMaxRetries;
      const updateMany = vi.fn().mockResolvedValue({});
      db.collection.mockReturnValue({
        updateMany,
      });
      const mockDate = new Date(20245, 10, 9);
      vi.setSystemTime(mockDate);
      await updateDeadEvents();
      expect(updateMany).toBeCalledWith(
        {
          completionAttempts: { $gte: MAX_RETRIES },
          status: {
            $nin: [
              OutboxStatus.DEAD_LETTER,
              OutboxStatus.COMPLETED,
              OutboxStatus.PURGED,
            ],
          },
        },
        {
          $set: {
            status: OutboxStatus.DEAD_LETTER,
            claimedAt: null,
            claimExpiresAt: null,
            claimedBy: null,
          },
        },
      );
    });
  });
});

describe("outbox.repository detail and redrive", () => {
  const ID = "665f1c2e9a1b2c3d4e5f6a7b";

  it("reads the whole document by id, projecting the claim token away", async () => {
    const doc = { _id: new ObjectId(ID), event: { id: "evt-1" } };
    const findOne = vi.fn().mockResolvedValue(doc);
    db.collection.mockReturnValue({ findOne });

    expect(await findById(ID)).toBe(doc);
    expect(findOne).toHaveBeenCalledWith(
      { _id: new ObjectId(ID) },
      { projection: { claimedBy: 0 }, ...MAX_TIME },
    );
  });

  it("returns null when there is no such row", async () => {
    db.collection.mockReturnValue({
      findOne: vi.fn().mockResolvedValue(null),
    });

    expect(await findById(ID)).toBeNull();
  });

  it("reads only the status for the 404-vs-409 decision", async () => {
    const findOne = vi.fn().mockResolvedValue({ status: "COMPLETED" });
    db.collection.mockReturnValue({ findOne });

    expect(await findStatusById(ID)).toBe("COMPLETED");
    expect(findOne).toHaveBeenCalledWith(
      { _id: new ObjectId(ID) },
      { projection: { status: 1 } },
    );
  });

  it("returns a null status for an unknown id", async () => {
    db.collection.mockReturnValue({
      findOne: vi.fn().mockResolvedValue(null),
    });

    expect(await findStatusById(ID)).toBeNull();
  });

  it("redrives with a single conditional update fenced on the redrivable statuses", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    db.collection.mockReturnValue({ updateOne });

    expect(await redriveById(ID)).toBe(true);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalledWith(
      {
        _id: new ObjectId(ID),
        status: { $in: [OutboxStatus.DEAD_LETTER, OutboxStatus.PURGED] },
      },
      {
        $set: {
          status: OutboxStatus.RESUBMITTED,
          retryable: true,
          completionAttempts: 0,
          attemptHistory: [],
          lastRedrive: { at: expect.any(String), by: null },
          expireAt: null,
          claimedBy: null,
          claimedAt: null,
          claimExpiresAt: null,
        },
        $inc: { payloadRevision: 1 },
      },
      {},
    );
  });

  it("answers false when the conditional update matched nothing", async () => {
    db.collection.mockReturnValue({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }),
    });

    expect(await redriveById(ID)).toBe(false);
  });

  describe("purgeById", () => {
    const PURGED_AT = new Date("2026-09-21T09:00:00.000Z");
    // now + EVENT_RETENTION_DAYS (90 by default), as a BSON Date.
    const DELETION_DATE = new Date("2026-12-20T09:00:00.000Z");

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(PURGED_AT);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("purges with a single conditional update fenced on DEAD_LETTER", async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      db.collection.mockReturnValue({ updateOne });

      expect(
        await purgeById(ID, {
          by: "donatas",
          reasonCode: "BROKEN_PAYLOAD",
          note: "the payload lost its clientRef",
        }),
      ).toBe(true);
      expect(updateOne).toHaveBeenCalledTimes(1);
      expect(updateOne).toHaveBeenCalledWith(
        { _id: new ObjectId(ID), status: OutboxStatus.DEAD_LETTER },
        {
          $set: {
            status: OutboxStatus.PURGED,
            lastPurge: {
              at: PURGED_AT.toISOString(),
              by: "donatas",
              reasonCode: "BROKEN_PAYLOAD",
              note: "the payload lost its clientRef",
            },
            expireAt: DELETION_DATE,
          },
          $inc: { payloadRevision: 1 },
        },
        {},
      );
    });

    // The purge and its audit event commit together, so the update joins the
    // use case's transaction.
    it("issues the update on the session it is given", async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      db.collection.mockReturnValue({ updateOne });
      const session = {};

      await purgeById(ID, { reasonCode: "SENT_IN_ERROR", session });

      expect(updateOne.mock.calls[0][2]).toEqual({ session });
    });

    it("stores a BSON Date, which is the only thing the TTL index reads", async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      db.collection.mockReturnValue({ updateOne });

      await purgeById(ID, { reasonCode: "SENT_IN_ERROR" });

      expect(updateOne.mock.calls[0][1].$set.expireAt).toBeInstanceOf(Date);
    });

    it("stores a null note and a null actor where neither was given", async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      db.collection.mockReturnValue({ updateOne });

      await purgeById(ID, { reasonCode: "SENT_IN_ERROR" });

      expect(updateOne.mock.calls[0][1].$set.lastPurge).toEqual({
        at: PURGED_AT.toISOString(),
        by: null,
        reasonCode: "SENT_IN_ERROR",
        note: null,
      });
      expect(JSON.stringify(updateOne.mock.calls[0][1])).not.toContain(
        "System",
      );
    });

    it("keeps the payload, the history and the error: a purge is not a redaction", async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      db.collection.mockReturnValue({ updateOne });

      await purgeById(ID, { reasonCode: "OTHER", note: "no longer wanted" });

      expect(Object.keys(updateOne.mock.calls[0][1].$set)).toEqual([
        "status",
        "lastPurge",
        "expireAt",
      ]);
    });

    it("answers false when the conditional update matched nothing", async () => {
      db.collection.mockReturnValue({
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }),
      });

      expect(await purgeById(ID, { reasonCode: "OTHER", note: "n" })).toBe(
        false,
      );
    });
  });
});

describe("outbox.repository payload edits", () => {
  const ID = "665f1c2e9a1b2c3d4e5f6a7b";
  const EDITED_AT = new Date("2026-09-23T14:08:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(EDITED_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const anEdit = (overrides = {}) => ({
    revision: 0,
    event: { id: "evt-1", time: "2026-06-16T10:00:00.000Z", data: { a: 2 } },
    original: { id: "evt-1", time: "2026-06-16T10:00:00.000Z", data: { a: 1 } },
    by: "donatas",
    note: "a was wrong",
    ...overrides,
  });

  it("reads what an edit decides on, in the transaction", async () => {
    const doc = { status: "DEAD_LETTER", event: { id: "evt-1" } };
    const findOne = vi.fn().mockResolvedValue(doc);
    db.collection.mockReturnValue({ findOne });
    const session = {};

    expect(await findEditableById(ID, session)).toBe(doc);
    expect(findOne).toHaveBeenCalledWith(
      { _id: new ObjectId(ID) },
      {
        projection: { status: 1, event: 1, payloadRevision: 1, lastEdit: 1 },
        session,
      },
    );
  });

  it("fences the write on a redrivable status and a missing, null or 0 revision for revision 0", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    db.collection.mockReturnValue({ updateOne });

    expect(await editPayloadById(ID, anEdit())).toBe(true);
    expect(updateOne.mock.calls[0][0]).toEqual({
      _id: new ObjectId(ID),
      status: { $in: [OutboxStatus.DEAD_LETTER, OutboxStatus.PURGED] },
      payloadRevision: { $in: [null, 0] },
    });
  });

  it("fences on the stored counter after the first edit", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    db.collection.mockReturnValue({ updateOne });

    await editPayloadById(ID, anEdit({ revision: 2, original: undefined }));

    expect(updateOne.mock.calls[0][0].payloadRevision).toBe(2);
    expect(updateOne.mock.calls[0][1].$set.payloadRevision).toBe(3);
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty(
      "originalPayload",
    );
  });

  it("keeps the original, records the edit and leaves the status alone", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    db.collection.mockReturnValue({ updateOne });

    await editPayloadById(ID, anEdit());

    const { $set } = updateOne.mock.calls[0][1];

    expect($set).toMatchObject({
      event: anEdit().event,
      payloadRevision: 1,
      lastEdit: {
        at: EDITED_AT.toISOString(),
        by: "donatas",
        note: "a was wrong",
      },
      originalPayload: anEdit().original,
    });
    expect($set).not.toHaveProperty("status");
    expect($set).not.toHaveProperty("attemptHistory");
  });

  it("issues the write on the session it is given", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    db.collection.mockReturnValue({ updateOne });
    const session = {};

    await editPayloadById(ID, anEdit({ session }));

    expect(updateOne.mock.calls[0][2]).toEqual({ session });
  });

  it("answers false when the fence matched nothing", async () => {
    db.collection.mockReturnValue({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }),
    });

    expect(await editPayloadById(ID, anEdit())).toBe(false);
  });

  it("sets no inbox columns on an outbox row", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    db.collection.mockReturnValue({ updateOne });

    await editPayloadById(ID, anEdit());

    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty("eventTime");
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty("type");
  });

  // The poller saves a whole model with `$set`, so a field the model does not
  // name is never written - and so never erased.
  it("leaves the edit fields out of a poller save", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    db.collection.mockReturnValue({ updateOne });
    const fromStored = Outbox.fromDocument({
      ...Outbox.createMock({ _id: new ObjectId(ID) }).toDocument(),
      payloadRevision: 2,
      lastEdit: { at: EDITED_AT.toISOString(), by: "donatas", note: "n" },
      originalPayload: { id: "evt-0" },
    });

    await update(fromStored, "claim-token");

    const { $set } = updateOne.mock.calls[0][1];

    expect($set).not.toHaveProperty("payloadRevision");
    expect($set).not.toHaveProperty("lastEdit");
    expect($set).not.toHaveProperty("originalPayload");
  });
});
