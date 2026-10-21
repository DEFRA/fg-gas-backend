import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { db } from "../../common/mongo-client.js";
import { Inbox, InboxStatus } from "../models/inbox.js";
import {
  claimEvents,
  deadLetterEvent,
  editPayloadById,
  findById,
  findEditableById,
  findByMessageId,
  findNextMessage,
  findStatusById,
  insertMany,
  insertOne,
  processExpiredEvents,
  purgeById,
  redriveById,
  update,
  updateDeadEvents,
  updateFailedEvents,
  updateResubmittedEvents,
} from "./inbox.repository.js";
import { STAMPED_FIELDS } from "../stamps.js";

vi.mock("../../common/mongo-client.js");

const MAX_TIME = { maxTimeMS: config.adminReadTimeoutMs };

const createMockInbox = (id, time) => {
  return Inbox.createMock({
    _id: id,
    event: {
      time,
    },
  });
};

describe("inbox.repository", () => {
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
            status: InboxStatus.DEAD_LETTER,
            claimedAt: null,
            claimExpiresAt: null,
            claimedBy: null,
          },
        },
      );
    });
  });

  it("should find next message excluding locked segregationRefs", async () => {
    const lockIds = ["ref-1", "ref-2"];
    const mockDoc = { _id: "1" };
    const findOne = vi.fn().mockResolvedValue(mockDoc);

    db.collection.mockReturnValue({ findOne });

    const result = await findNextMessage(lockIds);

    expect(findOne).toHaveBeenCalledWith(
      {
        status: { $eq: InboxStatus.PUBLISHED },
        claimedBy: { $eq: null },
        completionAttempts: { $lt: config.inbox.inboxMaxRetries },
        segregationRef: { $nin: lockIds },
      },
      { sort: { eventTime: 1 } },
    );
    expect(result).toBe(mockDoc);
  });

  it("should claim events", async () => {
    const claimedBy = randomUUID();
    const mockDocuments = [
      createMockInbox("1", new Date(Date.now() - 2000).toISOString()),
      createMockInbox("2", new Date(Date.now() - 3000).toISOString()),
    ];

    const findOneAndUpdate = vi.fn();
    findOneAndUpdate
      .mockResolvedValueOnce(mockDocuments[0])
      .mockResolvedValueOnce(mockDocuments[1]);

    db.collection.mockReturnValue({
      findOneAndUpdate,
    });

    const results = await claimEvents(claimedBy);
    expect(results).toHaveLength(2);
    expect(results[0]).toBeInstanceOf(Inbox);
    expect(results[0]._id).toBe("1");
    expect(results[1]).toBeInstanceOf(Inbox);
    expect(results[1]._id).toBe("2");
  });

  it("claims in eventTime order, not the admin list's publicationDate", async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue(null);
    db.collection.mockReturnValue({ findOneAndUpdate });

    await claimEvents(randomUUID(), "ref-1", 1);

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      { sort: { eventTime: 1 }, returnDocument: "after" },
    );
  });

  it("should insert many", async () => {
    const insertMany = vi.fn().mockResolvedValueOnce({ modifiedCount: 1 });
    db.collection.mockReturnValue({ insertMany });

    const events = [Inbox.createMock(), Inbox.createMock()];

    const mockSession = vi.fn();
    await insertMany(events, mockSession);
    expect(insertMany).toHaveBeenCalledWith(events, mockSession);
  });

  it("should process expired events", async () => {
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    db.collection.mockReturnValue({
      updateMany,
    });

    expect(await processExpiredEvents()).toEqual({ modifiedCount: 1 });

    expect(updateMany).toHaveBeenCalledWith(
      {
        claimExpiresAt: {
          $lt: expect.any(Date),
        },
        status: {
          $nin: [
            InboxStatus.DEAD_LETTER,
            InboxStatus.COMPLETED,
            InboxStatus.PURGED,
          ],
        },
      },
      {
        $set: {
          status: InboxStatus.FAILED,
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

  it("should update dead events", async () => {
    const updateMany = vi.fn().mockResolvedValue({});
    db.collection.mockReturnValue({ updateMany });

    await updateDeadEvents();

    expect(updateMany).toHaveBeenCalledWith(
      {
        completionAttempts: { $gte: config.inbox.inboxMaxRetries },
        status: {
          $nin: [
            InboxStatus.DEAD_LETTER,
            InboxStatus.COMPLETED,
            InboxStatus.PURGED,
          ],
        },
      },
      {
        $set: {
          status: InboxStatus.DEAD_LETTER,
          claimedAt: null,
          claimExpiresAt: null,
          claimedBy: null,
        },
      },
    );
  });

  it("should update resubmitted events", async () => {
    const updateMany = vi.fn().mockResolvedValue({});
    db.collection.mockReturnValue({ updateMany });

    await updateResubmittedEvents();

    expect(updateMany).toHaveBeenCalledWith(
      {
        status: InboxStatus.RESUBMITTED,
      },
      {
        $set: {
          status: InboxStatus.PUBLISHED,
          claimedAt: null,
          claimExpiresAt: null,
          claimedBy: null,
        },
      },
    );
  });

  it("should update failed events", async () => {
    const updateMany = vi.fn().mockResolvedValue({});
    db.collection.mockReturnValue({ updateMany });

    await updateFailedEvents();

    expect(updateMany).toHaveBeenCalledWith(
      {
        status: InboxStatus.FAILED,
      },
      {
        $set: {
          status: InboxStatus.RESUBMITTED,
          claimedAt: null,
          claimExpiresAt: null,
          claimedBy: null,
        },
      },
    );
  });

  it("should insertMany", async () => {
    const insertManySpy = vi.fn();
    db.collection.mockReturnValue({ insertMany: insertManySpy });
    const session = {};

    const events = [Inbox.createMock()];

    await insertMany(events, session);

    expect(insertManySpy.mock.calls[0][0][0]).toStrictEqual(
      events[0].toDocument(),
    );
  });

  it("should findByMessageId", async () => {
    const id = randomUUID();
    const mockDoc = { _id: id };
    const findOneMock = vi.fn().mockResolvedValue(mockDoc);
    db.collection.mockReturnValue({ findOne: findOneMock });
    const doc = await findByMessageId(id);
    expect(findOneMock).toHaveBeenCalledWith({ messageId: id });
    expect(mockDoc).toEqual(doc);
  });

  it("should insertOne", async () => {
    const insertOneMock = vi.fn();
    db.collection.mockReturnValue({ insertOne: insertOneMock });
    const session = {};
    const doc = Inbox.createMock();
    await insertOne(doc, session);
    expect(insertOneMock.mock.calls[0][0]).toStrictEqual(doc.toDocument());
  });

  it("should update a document only while the claim is held", async () => {
    const inbox = Inbox.createMock();
    const updateOneMock = vi.fn();
    db.collection.mockReturnValue({ updateOne: updateOneMock });

    await update(inbox, "claim-token-1");

    const { _id, eventType, refs, ...expected } = inbox;
    expect(updateOneMock).toHaveBeenCalledWith(
      { _id: inbox._id, claimedBy: "claim-token-1" },
      {
        $set: { ...expected, errorKey: null },
      },
    );
  });

  it("should never send the stamps back, so a stale copy cannot overwrite them", async () => {
    const inbox = Inbox.createMock({
      eventType: "case.status.updated",
      refs: ["ref:abc-123"],
    });
    const updateOneMock = vi.fn();
    db.collection.mockReturnValue({ updateOne: updateOneMock });

    await update(inbox, "claim-token-1");

    const sent = Object.keys(updateOneMock.mock.calls[0][1].$set);

    expect(sent.filter((key) => STAMPED_FIELDS.includes(key))).toEqual([]);
    expect(sent).toContain("status");
  });
});

describe("inbox.repository detail and redrive", () => {
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
        status: { $in: [InboxStatus.DEAD_LETTER, InboxStatus.PURGED] },
      },
      {
        $set: {
          status: InboxStatus.RESUBMITTED,
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
        { _id: new ObjectId(ID), status: InboxStatus.DEAD_LETTER },
        {
          $set: {
            status: InboxStatus.PURGED,
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

describe("inbox.repository payload edits", () => {
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
      status: { $in: [InboxStatus.DEAD_LETTER, InboxStatus.PURGED] },
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

  // The poller claims in `eventTime` order, so an edited `time` reorders the
  // row at once rather than after its next save.
  it("re-derives the type and eventTime columns from the new event", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    db.collection.mockReturnValue({ updateOne });

    await editPayloadById(ID, {
      ...anEdit(),
      event: { type: "a.new.type", time: "2026-09-20T08:00:00+01:00" },
    });

    expect(updateOne.mock.calls[0][1].$set).toMatchObject({
      type: "a.new.type",
      eventTime: "2026-09-20T07:00:00.000Z",
    });
  });

  // The poller saves a whole model with `$set`, so a field the model does not
  // name is never written - and so never erased.
  it("leaves the edit fields out of a poller save", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    db.collection.mockReturnValue({ updateOne });
    const fromStored = Inbox.fromDocument({
      ...Inbox.createMock().toDocument(),
      payloadRevision: 2,
      lastEdit: { at: EDITED_AT.toISOString(), by: "donatas", note: "n" },
      originalPayload: { id: "evt-0" },
    });

    await update(fromStored);

    const { $set } = updateOne.mock.calls[0][1];

    expect($set).not.toHaveProperty("payloadRevision");
    expect($set).not.toHaveProperty("lastEdit");
    expect($set).not.toHaveProperty("originalPayload");
  });
});
