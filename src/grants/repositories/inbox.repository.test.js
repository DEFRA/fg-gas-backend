import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { db } from "../../common/mongo-client.js";
import { Inbox, InboxStatus } from "../models/inbox.js";
import {
  claimEvents,
  deadLetterEvent,
  findByMessageId,
  findNextMessage,
  findPage,
  insertMany,
  insertOne,
  processExpiredEvents,
  update,
  updateDeadEvents,
  updateFailedEvents,
  updateResubmittedEvents,
} from "./inbox.repository.js";

vi.mock("../../common/mongo-client.js");

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
        completionAttempts: { $lte: config.inbox.inboxMaxRetries },
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

  it("should insert many", async () => {
    const insertMany = vi.fn().mockResolvedValueOnce({ modifiedCount: 1 });
    db.collection.mockReturnValue({ insertMany });

    const events = [Inbox.createMock(), Inbox.createMock()];

    const mockSession = vi.fn();
    await insertMany(events, mockSession);
    expect(insertMany).toHaveBeenCalledWith(events, mockSession);
  });

  it("should process expired events", async () => {
    const updateMany = vi.fn().mockResolvedValue({});
    db.collection.mockReturnValue({
      updateMany,
    });

    await processExpiredEvents();

    expect(updateMany).toHaveBeenCalledWith(
      {
        claimExpiresAt: {
          $lt: expect.any(Date),
        },
        status: { $nin: [InboxStatus.DEAD_LETTER, InboxStatus.COMPLETED] },
      },
      {
        $set: {
          status: InboxStatus.FAILED,
          claimedAt: null,
          claimedBy: null,
          claimExpiresAt: null,
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
        status: { $ne: InboxStatus.DEAD_LETTER },
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
        $inc: { completionAttempts: 1 },
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

  it("should update a document", async () => {
    const inbox = Inbox.createMock();
    const updateOneMock = vi.fn();
    db.collection.mockReturnValue({ updateOne: updateOneMock });

    await update(inbox);

    const { _id, ...expected } = inbox;
    expect(updateOneMock).toHaveBeenCalledWith(
      { _id: inbox._id },
      {
        $set: expected,
      },
    );
  });

  describe("findPage", () => {
    const mockFindChain = (docs) => {
      const chain = {
        project: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(docs),
      };
      const find = vi.fn().mockReturnValue(chain);
      db.collection.mockReturnValue({ find });
      return { find, chain };
    };

    const decodeCursor = (cursor) =>
      JSON.parse(Buffer.from(cursor, "base64url").toString());

    const listProjection = {
      _id: 1,
      messageId: 1,
      type: 1,
      source: 1,
      status: 1,
      completionAttempts: 1,
      traceparent: 1,
      eventTime: 1,
      lastResubmissionDate: 1,
      completionDate: 1,
      segregationRef: 1,
    };

    const id = "665f1c2e9a1b2c3d4e5f6a7b";
    const eventTime = "2026-06-16T10:00:00.000Z";

    it("queries the inbox newest-first with the _id tie-breaker", async () => {
      const { find, chain } = mockFindChain([]);

      await findPage();

      expect(find).toHaveBeenCalledWith({});
      expect(chain.sort).toHaveBeenCalledWith({ eventTime: -1, _id: -1 });
      expect(chain.limit).toHaveBeenCalledWith(21);
    });

    it("requests pageSize + 1 documents", async () => {
      const { chain } = mockFindChain([]);

      await findPage({ pageSize: 5 });

      expect(chain.limit).toHaveBeenCalledWith(6);
    });

    it("projects only the generic list fields", async () => {
      const { chain } = mockFindChain([]);

      await findPage();

      expect(chain.project).toHaveBeenCalledWith(listProjection);
    });

    it("never projects the payload or claim fields", async () => {
      const { chain } = mockFindChain([]);

      await findPage();

      const projection = chain.project.mock.calls[0][0];
      for (const field of [
        "event",
        "event.data",
        "claimedBy",
        "claimedAt",
        "claimExpiresAt",
        "publicationDate",
      ]) {
        expect(projection).not.toHaveProperty(field);
      }
    });

    it("projects traceparent so the list can link a row to its logs", async () => {
      const { chain } = mockFindChain([]);

      await findPage();

      expect(chain.project.mock.calls[0][0]).toHaveProperty("traceparent", 1);
    });

    it("applies the status filter when given", async () => {
      const { find } = mockFindChain([]);

      await findPage({ status: InboxStatus.DEAD_LETTER });

      expect(find).toHaveBeenCalledWith({ status: "DEAD_LETTER" });
    });

    it("returns every status when no filter is given", async () => {
      const { find } = mockFindChain([]);

      await findPage({});

      expect(find).toHaveBeenCalledWith({});
    });

    it("returns the raw documents without rebuilding the Inbox model", async () => {
      const doc = {
        _id: ObjectId.createFromHexString(id),
        messageId: "msg-1",
        type: "cloud.defra.local.fg-cw-backend.case.status.updated",
        source: "CW",
        status: InboxStatus.COMPLETED,
        completionAttempts: 1,
        eventTime,
        lastResubmissionDate: null,
        completionDate: "2026-06-16T10:05:00.000Z",
        segregationRef: "ref-1",
      };
      mockFindChain([doc]);

      const result = await findPage();

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toBe(doc);
      expect(result.data[0]).not.toHaveProperty("publicationDate");
    });

    it("encodes cursors from eventTime and _id", async () => {
      mockFindChain([{ _id: ObjectId.createFromHexString(id), eventTime }]);

      const result = await findPage();

      expect(decodeCursor(result.pagination.startCursor)).toEqual({
        eventTime,
        _id: id,
      });
      expect(decodeCursor(result.pagination.endCursor)).toEqual({
        eventTime,
        _id: id,
      });
    });

    it("resumes from a cursor with a decoded ObjectId", async () => {
      const cursor = Buffer.from(
        JSON.stringify({ eventTime, _id: id }),
      ).toString("base64url");
      const { find } = mockFindChain([]);

      await findPage({ cursor });

      const filter = find.mock.calls[0][0];
      expect(filter.$or).toEqual([
        { eventTime: { $lt: eventTime } },
        { eventTime, _id: { $lt: ObjectId.createFromHexString(id) } },
      ]);
      expect(filter.$or[1]._id.$lt).toBeInstanceOf(ObjectId);
    });

    it("rejects a tampered cursor", async () => {
      mockFindChain([]);

      await expect(findPage({ cursor: "!!!not-base64!!!" })).rejects.toThrow(
        "Cannot decode cursor",
      );

      mockFindChain([]);

      const nonHex = Buffer.from(
        JSON.stringify({ eventTime, _id: "nope" }),
      ).toString("base64url");

      await expect(findPage({ cursor: nonHex })).rejects.toThrow(
        "Cannot decode cursor",
      );
    });

    it("reverses order for a backward page", async () => {
      const older = {
        _id: ObjectId.createFromHexString("665f1c2e9a1b2c3d4e5f6a7a"),
        eventTime: "2026-06-16T09:00:00.000Z",
      };
      const newer = { _id: ObjectId.createFromHexString(id), eventTime };
      const { chain } = mockFindChain([older, newer]);

      const result = await findPage({ direction: "backward" });

      expect(chain.sort).toHaveBeenCalledWith({ eventTime: 1, _id: 1 });
      expect(result.data).toEqual([newer, older]);
    });
  });
});
