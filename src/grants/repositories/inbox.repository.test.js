import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { db } from "../../common/mongo-client.js";
import { Inbox, InboxStatus } from "../models/inbox.js";
import {
  claimEvents,
  countFacets,
  deadLetterEvent,
  findById,
  findByMessageId,
  findNextMessage,
  findPage,
  findStatusById,
  insertMany,
  insertOne,
  processExpiredEvents,
  redriveById,
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
        status: {
          $nin: [InboxStatus.DEAD_LETTER, InboxStatus.COMPLETED],
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
      lastError: 1,
      segregationRef: 1,
      lastRedrive: 1,
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

describe("inbox.repository findPage search", () => {
  const mockFind = () => {
    const chain = {
      project: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    };
    const find = vi.fn().mockReturnValue(chain);
    db.collection.mockReturnValue({ find });
    return find;
  };

  const filterFor = async (options) => {
    const find = mockFind();
    await findPage(options);
    return find.mock.calls[0][0];
  };

  it("projects lastError so the admin list can show why a row failed", async () => {
    const find = mockFind();

    await findPage();

    expect(find).toHaveBeenCalledWith({});
    expect(
      db.collection.mock.results[0].value.find.mock.results[0].value.project
        .mock.calls[0][0],
    ).toHaveProperty("lastError", 1);
  });

  it("matches q against messageId, segregationRef and its prefix", async () => {
    const filter = await filterFor({ q: "msg-1" });

    expect(filter.$or).toContainEqual({ messageId: "msg-1" });
    expect(filter.$or).toContainEqual({ segregationRef: "msg-1" });
    expect(filter.$or).toContainEqual({
      segregationRef: { $regex: "^msg-1", $options: "i" },
    });
  });

  it("matches a 24-hex q against _id as well", async () => {
    const hex = "665f1c2e9a1b2c3d4e5f6a7b";

    expect((await filterFor({ q: hex })).$or).toContainEqual({
      _id: ObjectId.createFromHexString(hex),
    });
  });

  it("combines status and q with $and", async () => {
    const filter = await filterFor({ status: "FAILED", q: "msg-1" });

    expect(filter.$and[0]).toEqual({ status: "FAILED" });
  });

  // The TYPE filter is gone: a stray `kind` selects nothing and excludes
  // nothing. Audit rows are still recognised structurally for DISPLAY.
  it("ignores a kind key rather than filtering on it", async () => {
    expect(await filterFor({ kind: "audit" })).toEqual({});
  });

  it("ignores a whitespace-only q", async () => {
    expect(await filterFor({ q: "   " })).toEqual({});
  });
});

describe("inbox.repository detail and redrive", () => {
  const ID = "665f1c2e9a1b2c3d4e5f6a7b";

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
    lastError: 1,
    segregationRef: 1,
    lastRedrive: 1,
  };

  it("reads the whole document by id, projecting the claim token away", async () => {
    const doc = { _id: new ObjectId(ID), event: { id: "evt-1" } };
    const findOne = vi.fn().mockResolvedValue(doc);
    db.collection.mockReturnValue({ findOne });

    expect(await findById(ID)).toBe(doc);
    expect(findOne).toHaveBeenCalledWith(
      { _id: new ObjectId(ID) },
      { projection: { claimedBy: 0 } },
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

  it("redrives with a single conditional update filtered on DEAD_LETTER", async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue(null);
    db.collection.mockReturnValue({ findOneAndUpdate });

    await redriveById(ID);

    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: new ObjectId(ID), status: InboxStatus.DEAD_LETTER },
      {
        $set: {
          status: InboxStatus.RESUBMITTED,
          completionAttempts: 0,
          lastRedrive: { at: expect.any(String), by: null },
          claimedBy: null,
          claimedAt: null,
          claimExpiresAt: null,
        },
      },
      { returnDocument: "after", projection: listProjection },
    );
  });

  it("answers with the updated document in the payload-free list projection", async () => {
    const updated = { _id: new ObjectId(ID), status: InboxStatus.RESUBMITTED };
    db.collection.mockReturnValue({
      findOneAndUpdate: vi.fn().mockResolvedValue(updated),
    });

    expect(await redriveById(ID)).toBe(updated);
  });

  it("returns null when the conditional update matched nothing", async () => {
    db.collection.mockReturnValue({
      findOneAndUpdate: vi.fn().mockResolvedValue(null),
    });

    expect(await redriveById(ID)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Time range and per-status counts (the events admin surface)
// ---------------------------------------------------------------------------

const FROM = "2026-06-16T00:00:00.000Z";
const TO = "2026-06-16T23:59:59.999Z";

const mockRangeFind = () => {
  const chain = {
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([]),
  };
  const find = vi.fn().mockReturnValue(chain);

  db.collection.mockReturnValue({ find });

  return find;
};

const mockAggregate = (rows) => {
  const aggregate = vi.fn().mockReturnValue({
    toArray: vi.fn().mockResolvedValue(rows),
  });

  db.collection.mockReturnValue({ aggregate });

  return aggregate;
};

describe("inbox.repository findPage from/to", () => {
  it("filters on eventTime as a string, inclusive at both ends", async () => {
    const find = mockRangeFind();

    await findPage({ from: FROM, to: TO });

    expect(find).toHaveBeenCalledWith({
      eventTime: { $gte: FROM, $lte: TO },
    });
  });

  it("accepts each bound on its own", async () => {
    const find = mockRangeFind();

    await findPage({ from: FROM });

    expect(find).toHaveBeenCalledWith({ eventTime: { $gte: FROM } });
  });

  it("filters on nothing when no bound is given", async () => {
    const find = mockRangeFind();

    await findPage({});

    expect(find).toHaveBeenCalledWith({});
  });

  it("combines the range with the other filters", async () => {
    const find = mockRangeFind();

    await findPage({ status: "FAILED", from: FROM });

    expect(find).toHaveBeenCalledWith({
      $and: [{ status: "FAILED" }, { eventTime: { $gte: FROM } }],
    });
  });
});

describe("inbox.repository countFacets", () => {
  it("matches the same rows as the list and groups them by status", async () => {
    const aggregate = mockAggregate([]);

    await countFacets({ from: FROM, to: TO });

    expect(aggregate).toHaveBeenCalledWith([
      { $match: { eventTime: { $gte: FROM, $lte: TO } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
  });

  it("counts the whole box when nothing is filtered", async () => {
    const aggregate = mockAggregate([]);

    await countFacets();

    expect(aggregate.mock.calls[0][0][0]).toEqual({ $match: {} });
  });

  it("zero-fills the status block for an empty box", async () => {
    mockAggregate([]);

    expect(await countFacets()).toEqual({
      counts: {
        PUBLISHED: 0,
        PROCESSING: 0,
        FAILED: 0,
        RESUBMITTED: 0,
        COMPLETED: 0,
        DEAD_LETTER: 0,
      },
    });
  });

  it("counts the rows the $group emits into their statuses", async () => {
    mockAggregate([
      { _id: "FAILED", count: 3 },
      { _id: "DEAD_LETTER", count: 1 },
    ]);

    const { counts } = await countFacets();

    expect(counts.FAILED).toBe(3);
    expect(counts.DEAD_LETTER).toBe(1);
  });
});
