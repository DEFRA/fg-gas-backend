import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { db } from "../../common/mongo-client.js";
import { Outbox, OutboxStatus } from "../models/outbox.js";
import {
  breakdown,
  claimEvents,
  countFacets,
  deadLetterEvent,
  findById,
  findNextMessage,
  findPage,
  findStatusById,
  insertMany,
  redriveById,
  update,
  updateDeadEvents,
  updateExpiredEvents,
  updateFailedEvents,
  updateResubmittedEvents,
} from "./outbox.repository.js";

vi.mock("../../common/mongo-client.js");

// The admin surface's own ceiling on a read that can be a collection scan.
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

      expect(mockInsertMany).toHaveBeenCalledWith(events, {
        session: mockSession,
      });
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
            event: {},
            lastResubmissionDate: undefined,
            lastError: null,
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
            $nin: [OutboxStatus.DEAD_LETTER, OutboxStatus.COMPLETED],
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
                  // Nothing threw, so there is no stack to reveal.
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
          status: { $ne: OutboxStatus.DEAD_LETTER },
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
      target: 1,
      "event.id": 1,
      "event.type": 1,
      status: 1,
      completionAttempts: 1,
      publicationDate: 1,
      lastResubmissionDate: 1,
      completionDate: 1,
      lastError: 1,
    };

    const id = "665f1c2e9a1b2c3d4e5f6a7b";
    const publicationDate = new Date("2026-06-16T10:00:00.000Z");

    it("queries the outbox newest-first with the _id tie-breaker", async () => {
      const { find, chain } = mockFindChain([]);

      await findPage();

      expect(find).toHaveBeenCalledWith({}, MAX_TIME);
      expect(chain.sort).toHaveBeenCalledWith({
        publicationDate: -1,
        _id: -1,
      });
      expect(chain.limit).toHaveBeenCalledWith(21);
    });

    it("requests pageSize + 1 documents", async () => {
      const { chain } = mockFindChain([]);

      await findPage({ pageSize: 5 });

      expect(chain.limit).toHaveBeenCalledWith(6);
    });

    it("projects only the generic list fields and the derivable event subfields", async () => {
      const { chain } = mockFindChain([]);

      await findPage();

      expect(chain.project).toHaveBeenCalledWith(listProjection);
    });

    it("never projects the full event, event.data, audit details, claim or detail-only fields", async () => {
      const { chain } = mockFindChain([]);

      await findPage();

      const projection = chain.project.mock.calls[0][0];
      for (const field of [
        "event",
        "event.data",
        "claimedBy",
        "claimedAt",
        "claimExpiresAt",
        "event.traceparent",
        "event.audit.entities.entity",
        "event.audit.entities.entityid",
        "event.audit.details",
        "segregationRef",
        "lastRedrive",
        "attemptHistory",
      ]) {
        expect(projection).not.toHaveProperty(field);
      }
    });

    it("projects no event key beyond the id and type the row derives from", async () => {
      const { chain } = mockFindChain([]);

      await findPage();

      const eventKeys = Object.keys(chain.project.mock.calls[0][0]).filter(
        (key) => key.startsWith("event"),
      );

      expect(eventKeys).toEqual(["event.id", "event.type"]);
    });

    it("applies the status filter when given", async () => {
      const { find } = mockFindChain([]);

      await findPage({ status: OutboxStatus.FAILED });

      expect(find).toHaveBeenCalledWith({ status: "FAILED" }, MAX_TIME);
    });

    it("returns every status when no filter is given", async () => {
      const { find } = mockFindChain([]);

      await findPage({});

      expect(find).toHaveBeenCalledWith({}, MAX_TIME);
    });

    it("encodes a Date publicationDate as ISO in the cursor", async () => {
      mockFindChain([
        { _id: ObjectId.createFromHexString(id), publicationDate },
      ]);

      const result = await findPage();

      expect(decodeCursor(result.pagination.startCursor)).toEqual({
        publicationDate: "2026-06-16T10:00:00.000Z",
        _id: id,
      });
    });

    it("decodes the cursor back to a Date for the paging filter", async () => {
      const cursor = Buffer.from(
        JSON.stringify({
          publicationDate: "2026-06-16T10:00:00.000Z",
          _id: id,
        }),
      ).toString("base64url");
      const { find } = mockFindChain([]);

      await findPage({ cursor });

      const filter = find.mock.calls[0][0];
      const [, keyset] = filter.$and;

      expect(keyset.$or[0].publicationDate.$lt).toEqual(
        new Date("2026-06-16T10:00:00.000Z"),
      );
      expect(keyset.$or[1]._id.$lt).toBeInstanceOf(ObjectId);
    });

    it("rejects a tampered cursor", async () => {
      mockFindChain([]);

      await expect(findPage({ cursor: "!!!not-base64!!!" })).rejects.toThrow(
        "Cannot decode cursor",
      );

      mockFindChain([]);

      const nonHex = Buffer.from(
        JSON.stringify({
          publicationDate: "2026-06-16T10:00:00.000Z",
          _id: "nope",
        }),
      ).toString("base64url");

      await expect(findPage({ cursor: nonHex })).rejects.toThrow(
        "Cannot decode cursor",
      );
    });

    it("reverses order for a backward page", async () => {
      const older = {
        _id: ObjectId.createFromHexString("665f1c2e9a1b2c3d4e5f6a7a"),
        publicationDate: new Date("2026-06-16T09:00:00.000Z"),
      };
      const newer = { _id: ObjectId.createFromHexString(id), publicationDate };
      const { chain } = mockFindChain([older, newer]);

      const result = await findPage({ direction: "backward" });

      expect(chain.sort).toHaveBeenCalledWith({ publicationDate: 1, _id: 1 });
      expect(result.data).toEqual([newer, older]);
    });

    it("returns audit rows with only entity and action", async () => {
      const auditDoc = {
        _id: ObjectId.createFromHexString(id),
        target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit",
        event: {
          audit: {
            entities: [{ entity: "APPLICATION", action: "CREATE" }],
          },
        },
        status: OutboxStatus.COMPLETED,
        completionAttempts: 1,
        publicationDate,
        segregationRef: "ref-1",
      };
      mockFindChain([auditDoc]);

      const result = await findPage();

      expect(result.data).toEqual([auditDoc]);
      expect(result.data[0].event).not.toHaveProperty("id");
      expect(result.data[0].event).not.toHaveProperty("type");
    });
  });
});

describe("outbox.repository findPage search", () => {
  const mockFind = () => {
    const chain = {
      project: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    };
    const find = vi.fn().mockReturnValue(chain);
    db.collection.mockReturnValue({ find });
    return { find, chain };
  };

  const filterFor = async (options) => {
    const { find } = mockFind();
    await findPage(options);
    return find.mock.calls[0][0];
  };

  it("projects lastError so the admin list can show why a row failed", async () => {
    const { chain } = mockFind();

    await findPage();

    expect(chain.project.mock.calls[0][0]).toHaveProperty("lastError", 1);
  });

  it("matches q against event.id, segregationRef and its prefix", async () => {
    const filter = await filterFor({ q: "evt-1" });

    expect(filter.$or).toContainEqual({ "event.id": "evt-1" });
    expect(filter.$or).toContainEqual({ segregationRef: "evt-1" });
    expect(filter.$or).toContainEqual({
      segregationRef: { $regex: "^evt-1", $options: "i" },
    });
  });

  it("escapes regex metacharacters in q", async () => {
    expect((await filterFor({ q: "GLD.9B2+x" })).$or).toContainEqual({
      segregationRef: { $regex: "^GLD\\.9B2\\+x", $options: "i" },
    });
  });

  it("ignores a kind key rather than filtering on it", async () => {
    expect(await filterFor({ kind: "audit" })).toEqual({});
    expect(await filterFor({ kind: "domain" })).toEqual({});
  });

  it("combines status and q with $and", async () => {
    const filter = await filterFor({ status: "FAILED", q: "evt-1" });

    expect(filter.$and).toHaveLength(2);
    expect(filter.$and[0]).toEqual({ status: "FAILED" });
  });

  it("ignores a whitespace-only q", async () => {
    expect(await filterFor({ q: "  " })).toEqual({});
  });
});

describe("outbox.repository detail and redrive", () => {
  const ID = "665f1c2e9a1b2c3d4e5f6a7b";

  const listProjection = {
    _id: 1,
    target: 1,
    "event.id": 1,
    "event.type": 1,
    status: 1,
    completionAttempts: 1,
    publicationDate: 1,
    lastResubmissionDate: 1,
    completionDate: 1,
    lastError: 1,
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
      { _id: new ObjectId(ID), status: OutboxStatus.DEAD_LETTER },
      {
        $set: {
          status: OutboxStatus.RESUBMITTED,
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
    const updated = { _id: new ObjectId(ID), status: OutboxStatus.RESUBMITTED };
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

describe("outbox.repository findPage from/to", () => {
  it("filters on publicationDate coerced to a Date, inclusive at both ends", async () => {
    const find = mockRangeFind();

    await findPage({ from: FROM, to: TO });

    expect(find).toHaveBeenCalledWith(
      {
        publicationDate: { $gte: new Date(FROM), $lte: new Date(TO) },
      },
      MAX_TIME,
    );
  });

  it("accepts each bound on its own", async () => {
    const find = mockRangeFind();

    await findPage({ from: FROM });

    expect(find).toHaveBeenCalledWith(
      {
        publicationDate: { $gte: new Date(FROM) },
      },
      MAX_TIME,
    );
  });

  it("filters on nothing when no bound is given", async () => {
    const find = mockRangeFind();

    await findPage({});

    expect(find).toHaveBeenCalledWith({}, MAX_TIME);
  });

  it("combines the range with the other filters", async () => {
    const find = mockRangeFind();

    await findPage({ status: "FAILED", from: FROM });

    expect(find).toHaveBeenCalledWith(
      {
        $and: [
          { status: "FAILED" },
          { publicationDate: { $gte: new Date(FROM) } },
        ],
      },
      MAX_TIME,
    );
  });
});

describe("outbox.repository countFacets", () => {
  it("matches the same rows as the list and groups them by status", async () => {
    const aggregate = mockAggregate([]);

    await countFacets({ from: FROM, to: TO });

    expect(aggregate).toHaveBeenCalledWith(
      [
        {
          $match: {
            publicationDate: { $gte: new Date(FROM), $lte: new Date(TO) },
          },
        },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ],
      MAX_TIME,
    );
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
      { _id: "FAILED", count: 5 },
      { _id: "COMPLETED", count: 5 },
    ]);

    const { counts } = await countFacets();

    expect(counts.FAILED).toBe(5);
    expect(counts.COMPLETED).toBe(5);
  });
});

// The audit dimension - the query-level half of the predicate in
// events/event-audit.js, applied through the shared filter builder.

describe("outbox.repository audit", () => {
  // The topic write-audit-event.js addresses, matched by name under any
  // account id.
  const AUDIT_CLAUSE = {
    target: { $not: /(^|:)gas__sns__audit_topic_arn$/ },
  };

  const mockFindChain = () => {
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

  const aggregateStages = async (run) => {
    const aggregate = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    db.collection.mockReturnValue({ aggregate });
    await run();

    return aggregate.mock.calls[0][0];
  };

  const findFilter = async (options) => {
    const find = mockFindChain();

    await findPage(options);

    return find.mock.calls[0][0];
  };

  // Identified by destination, never by a missing type: a row that recorded no
  // type but was sent somewhere else is an anomaly and survives this.
  it("removes only the rows addressed at the audit topic", async () => {
    expect(await findFilter({ audit: "exclude" })).toEqual(AUDIT_CLAUSE);
  });

  it("adds no clause at all when audit records are included", async () => {
    expect(await findFilter({ audit: "include" })).toEqual({});
  });

  it("ands the clause with every other filter rather than replacing them", async () => {
    expect(await findFilter({ status: "FAILED", audit: "exclude" })).toEqual({
      $and: [{ status: "FAILED" }, AUDIT_CLAUSE],
    });
  });

  it("counts the same population the list lists", async () => {
    const stages = await aggregateStages(() =>
      countFacets({ audit: "exclude" }),
    );

    expect(stages[0]).toEqual({ $match: AUDIT_CLAUSE });
  });

  it("groups the same population in the breakdown", async () => {
    const stages = await aggregateStages(() => breakdown({ audit: "exclude" }));

    expect(stages[0]).toEqual({
      $match: { $and: [{ status: "DEAD_LETTER" }, AUDIT_CLAUSE] },
    });
  });

  it("groups every dead letter, audit records included, when they are included", async () => {
    const stages = await aggregateStages(() => breakdown({ audit: "include" }));

    expect(stages[0]).toEqual({ $match: { status: "DEAD_LETTER" } });
  });

  // So the merge can tell an audit group from a type-less anomaly: both group
  // under a null type and they are not the same thing.
  it("asks the $group whether each row was addressed at the audit topic", async () => {
    const stages = await aggregateStages(() => breakdown({}));

    expect(stages[1].$group._id.audit).toEqual({
      $eq: [
        { $arrayElemAt: [{ $split: ["$target", ":"] }, -1] },
        "gas__sns__audit_topic_arn",
      ],
    });
  });
});
