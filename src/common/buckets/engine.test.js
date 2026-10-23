import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../logger.js";
import { db } from "../mongo-client.js";
import { describeBucket } from "./catalogue.js";
import { encodeCursor } from "./cursor.js";
import {
  COUNT_CAP,
  MAX_VALUES,
  SUMMARY_COUNT_CAP,
  parseQuery,
  readBucketTimeline,
  readTimeline,
  runQuery,
} from "./engine.js";
import { ensureIndexes } from "./indexes.js";
import { SCAN_BUDGET } from "./plan.js";
import { clearBuckets, registerBucket } from "./registry.js";
import {
  catalogueEntrySchema,
  queryRequestSchema,
  queryResponseSchema,
  summaryRequestSchema,
  summaryResponseSchema,
  timelineResponseSchema,
} from "./schema.js";
import { parseSummary, runSummary } from "./summary.js";
import { ledBucket, testBucket } from "./test-bucket.js";

vi.mock("../actuator-read.js", () => ({
  actuatorReadMaxTimeMs: () => 5000,
}));
vi.mock("../logger.js", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("../mongo-client.js", () => ({ db: { collection: vi.fn() } }));

const bucket = testBucket();

const id = (n) =>
  ObjectId.createFromHexString(n.toString(16).padStart(24, "0"));

const doc = (n, fields = {}) => ({
  _id: id(n),
  publicationDate: new Date(Date.UTC(2026, 9, 9, 9, 0, n)),
  eventType: "case.create",
  status: "COMPLETED",
  ...fields,
});

const cursorOf = (row) => encodeCursor({ t: row.publicationDate, i: row._id });

const parse = (body) =>
  parseQuery(bucket, queryRequestSchema.validate(body).value);

const reasonOf = (reason) =>
  expect.objectContaining({
    output: expect.objectContaining({
      payload: expect.objectContaining({ reason }),
    }),
  });

const timedOut = () => Object.assign(new Error("timed out"), { code: 50 });

const makeCollection = (answers) => {
  const { finds, count, groups } = {
    finds: [],
    count: 0,
    groups: [],
    ...answers,
  };
  const pending = [...finds];
  const nextFind = async () => (pending.length ? pending.shift() : []);
  const collection = {
    find: vi.fn(() => ({ toArray: vi.fn(nextFind) })),
    countDocuments: vi.fn(async () => count),
    aggregate: vi.fn(() => ({ toArray: vi.fn(async () => groups) })),
  };

  db.collection.mockReturnValue(collection);

  return collection;
};

const holdsOr = (value) => JSON.stringify(value).includes('"$or"');

describe("parseQuery", () => {
  it("returns the query with its plan", () => {
    const query = parse({
      where: { status: "DEAD_LETTER", eventType: "case.create" },
      groupBy: ["status"],
    });

    expect(query).toEqual({
      where: { status: "DEAD_LETTER", eventType: "case.create" },
      asked: ["status", "eventType"],
      show: [],
      ref: null,
      refKind: null,
      groupBy: ["status"],
      cursor: null,
      from: undefined,
      to: undefined,
      limit: 20,
      plan: {
        kind: "exact",
        line: ["status", "eventType"],
        filled: [],
        residual: [],
      },
    });
  });

  it("normalises the ref and names its kind", () => {
    expect(parse({ ref: "ref: ABC-123:xyz " })).toMatchObject({
      ref: "ref:abc-123:xyz",
      refKind: "ref",
    });
  });

  it("accepts a ref of a kind the bucket declares as a link", () => {
    const linked = testBucket({ links: ["case"] });

    expect(
      parseQuery(
        linked,
        queryRequestSchema.validate({ ref: "case:W:ABC-1" }).value,
      ),
    ).toMatchObject({ ref: "case:w:abc-1", refKind: "case" });
  });

  it("decodes the cursor to the stored types", () => {
    const row = doc(1);

    expect(parse({ cursor: cursorOf(row) }).cursor).toEqual({
      t: row.publicationDate,
      i: row._id,
    });
  });

  it.each([
    ["an undeclared fact", { where: { colour: "x" } }, "UNKNOWN_FACT"],
    [
      "a payload path",
      { where: { "event.data.caseRef": "x" } },
      "UNKNOWN_FACT",
    ],
    [
      "an inherited property name",
      { where: { constructor: "x" } },
      "UNKNOWN_FACT",
    ],
    ["a ref of an undeclared kind", { ref: "nokind:1" }, "UNKNOWN_REF_KIND"],
    ["a ref with no kind", { ref: "abc-123" }, "UNKNOWN_REF_KIND"],
    ["a ref with no value", { ref: "ref: " }, "UNKNOWN_REF_KIND"],
    [
      "a grouping the bucket does not declare",
      { groupBy: ["grantCode"] },
      "UNKNOWN_GROUPING",
    ],
    ["a cursor that does not decode", { cursor: "x" }, "INVALID_CURSOR"],
    [
      "from after to",
      { from: "2026-10-09T12:00:00.000Z", to: "2026-10-08T12:00:00.000Z" },
      "INVALID_RANGE",
    ],
  ])("refuses %s", (_, body, reason) => {
    expect(() => parse(body)).toThrow(reasonOf(reason));
  });

  it("accepts a value outside a fact's value list", () => {
    expect(parse({ where: { status: "NO_SUCH_STATUS" } }).where).toEqual({
      status: "NO_SUCH_STATUS",
    });
  });

  it("accepts from equal to to", () => {
    const at = "2026-10-09T12:00:00.000Z";

    expect(parse({ from: at, to: at })).toMatchObject({ from: at, to: at });
  });
});

describe("runQuery", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-10-09T12:00:00.000Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("an exact read", () => {
    it("reads one page on the time-only key for the empty query", async () => {
      const collection = makeCollection({ finds: [[doc(2), doc(1)]] });

      const result = await runQuery(bucket, parse({}));

      expect(db.collection).toHaveBeenCalledWith("outbox");
      expect(collection.find).toHaveBeenCalledExactlyOnceWith(
        {},
        {
          hint: { publicationDate: -1, _id: -1 },
          sort: { publicationDate: -1, _id: -1 },
          projection: { eventType: 1, status: 1, publicationDate: 1 },
          limit: 21,
          maxTimeMS: 5000,
        },
      );
      expect(result).toEqual({
        bucket: "test.outbox",
        plan: {
          kind: "exact",
          index: ["publicationDate", "_id"],
          bound: [],
          filled: [],
          residual: [],
          scans: 1,
        },
        rows: [
          {
            id: id(2).toString(),
            time: "2026-10-09T09:00:02.000Z",
            title: "case.create",
            subtitle: null,
            cells: { status: "COMPLETED" },
            link: null,
          },
          expect.objectContaining({ id: id(1).toString() }),
        ],
        page: {
          next: null,
          keepLooking: null,
          searchedTo: null,
          complete: true,
        },
        groups: [],
      });
      expect(queryResponseSchema.validate(result).error).toBeUndefined();
    });

    it("binds the asked facts of the line and the time range", async () => {
      const collection = makeCollection();

      const result = await runQuery(
        bucket,
        parse({
          where: { eventType: "case.create", status: "DEAD_LETTER" },
          from: "2026-10-08T12:00:00Z",
          to: "2026-10-09T12:00:00Z",
        }),
      );

      expect(collection.find.mock.calls[0][0]).toEqual({
        $and: [
          { status: "DEAD_LETTER", eventType: "case.create" },
          {
            publicationDate: {
              $gte: new Date("2026-10-08T12:00:00.000Z"),
              $lte: new Date("2026-10-09T12:00:00.000Z"),
            },
          },
        ],
      });
      expect(collection.find.mock.calls[0][1].hint).toEqual({
        status: 1,
        eventType: 1,
        publicationDate: -1,
        _id: -1,
      });
      expect(result.plan).toMatchObject({
        index: ["status", "eventType", "publicationDate", "_id"],
        bound: ["status", "eventType"],
        scans: 1,
      });
    });

    it("fills a leading fact with its listed values and null", async () => {
      const collection = makeCollection();

      const result = await runQuery(
        bucket,
        parse({ where: { eventType: "case.create" } }),
      );

      expect(collection.find.mock.calls[0][0]).toEqual({
        $and: [
          { eventType: "case.create" },
          {
            status: {
              $in: [
                "PUBLISHED",
                "PROCESSING",
                "FAILED",
                "RESUBMITTED",
                "COMPLETED",
                "DEAD_LETTER",
                "PURGED",
                null,
              ],
            },
          },
        ],
      });
      expect(result.plan).toMatchObject({
        kind: "exact",
        bound: ["eventType"],
        filled: ["status"],
        scans: 8,
      });
    });

    it("compares an isoString time as a string", async () => {
      const strings = testBucket({
        time: { field: "createdAt", type: "isoString", label: "Created" },
      });
      const collection = makeCollection();

      await runQuery(
        strings,
        parseQuery(
          strings,
          queryRequestSchema.validate({ from: "2026-10-08T12:00:00Z" }).value,
        ),
      );

      expect(collection.find.mock.calls[0][0]).toEqual({
        $and: [{ createdAt: { $gte: "2026-10-08T12:00:00.000Z" } }],
      });
    });

    it("drops the extra row and answers the cursor of the last row kept", async () => {
      makeCollection({ finds: [[doc(3), doc(2), doc(1)]] });

      const result = await runQuery(bucket, parse({ limit: 2 }));

      expect(result.rows.map((row) => row.id)).toEqual([
        id(3).toString(),
        id(2).toString(),
      ]);
      expect(result.page).toEqual({
        next: cursorOf(doc(2)),
        keepLooking: null,
        searchedTo: null,
        complete: false,
      });
    });

    it("continues after a cursor without an $or", async () => {
      const collection = makeCollection();
      const last = doc(2);

      await runQuery(bucket, parse({ cursor: cursorOf(last) }));

      expect(collection.find.mock.calls[0][0]).toEqual({
        $and: [
          { publicationDate: { $lte: last.publicationDate } },
          {
            $nor: [
              {
                publicationDate: last.publicationDate,
                _id: { $gte: last._id },
              },
            ],
          },
        ],
      });
    });

    it("leads on the refs key for a ref", async () => {
      const collection = makeCollection();

      const result = await runQuery(bucket, parse({ ref: "msg:ABC" }));

      expect(collection.find).toHaveBeenCalledExactlyOnceWith(
        { $and: [{ refs: "msg:abc" }] },
        expect.objectContaining({
          hint: { refs: 1, publicationDate: -1, _id: -1 },
        }),
      );
      expect(result.plan).toEqual({
        kind: "exact",
        index: ["refs", "publicationDate", "_id"],
        bound: ["ref"],
        filled: [],
        residual: [],
        scans: 1,
      });
    });

    describe("a bucket led by a fact that hides a value", () => {
      const led = ledBucket();
      const run = (body) =>
        runQuery(led, parseQuery(led, queryRequestSchema.validate(body).value));

      it("fills the unasked lead with the values it shows, and null", async () => {
        const collection = makeCollection();

        const result = await run({ where: { status: "FAILED" } });

        expect(collection.find).toHaveBeenCalledExactlyOnceWith(
          {
            $and: [
              { status: "FAILED" },
              {
                eventType: { $in: ["case.create", "case.update.status", null] },
              },
            ],
          },
          expect.objectContaining({
            hint: { eventType: 1, status: 1, publicationDate: -1, _id: -1 },
          }),
        );
        expect(result.plan).toEqual({
          kind: "exact",
          index: ["eventType", "status", "publicationDate", "_id"],
          bound: ["status"],
          filled: ["eventType"],
          residual: [],
          scans: 3,
        });
      });

      it("fills it with every listed value once the fact is shown", async () => {
        const collection = makeCollection();

        const result = await run({ show: ["eventType"] });

        expect(collection.find.mock.calls[0][0]).toEqual({
          $and: [
            {
              eventType: {
                $in: ["case.create", "case.update.status", "audit", null],
              },
            },
          ],
        });
        expect(result.plan).toMatchObject({ kind: "exact", scans: 4 });
      });

      it("reads a hidden value that is asked for by name", async () => {
        const collection = makeCollection();

        const result = await run({ where: { eventType: "audit" } });

        expect(collection.find.mock.calls[0][0]).toEqual({
          $and: [{ eventType: "audit" }],
        });
        expect(result.plan).toMatchObject({
          kind: "exact",
          bound: ["eventType"],
          scans: 1,
        });
      });

      it("fills or binds the lead in front of a ref", async () => {
        const collection = makeCollection();

        const filled = await run({ ref: "msg:ABC" });
        const bound = await run({
          where: { eventType: "case.create" },
          ref: "msg:ABC",
        });

        expect(collection.find.mock.calls[0]).toEqual([
          {
            $and: [
              {
                eventType: { $in: ["case.create", "case.update.status", null] },
              },
              { refs: "msg:abc" },
            ],
          },
          expect.objectContaining({
            hint: { eventType: 1, refs: 1, publicationDate: -1, _id: -1 },
          }),
        ]);
        expect(filled.plan).toMatchObject({
          kind: "exact",
          bound: ["ref"],
          filled: ["eventType"],
          scans: 3,
        });
        expect(bound.plan).toMatchObject({
          kind: "exact",
          bound: ["eventType", "ref"],
          scans: 1,
        });
      });

      it("counts a group and its total over the values shown", async () => {
        const collection = makeCollection({ count: 2 });

        await run({ groupBy: ["status"] });

        expect(collection.countDocuments).toHaveBeenCalledTimes(8);
        expect(
          collection.countDocuments.mock.calls.every(([filter]) =>
            JSON.stringify(filter).includes(
              '"eventType":{"$in":["case.create","case.update.status",null]}',
            ),
          ),
        ).toBe(true);
      });

      it("refuses to show a fact the bucket does not declare", () => {
        expect(() =>
          parseQuery(
            led,
            queryRequestSchema.validate({ show: ["colour"] }).value,
          ),
        ).toThrow(reasonOf("UNKNOWN_FACT"));
      });
    });

    it("tests a fact that hides a value on each row when no key holds it", async () => {
      const loose = ledBucket({ lead: [], indexes: [["status"]] });
      const collection = makeCollection();

      const result = await runQuery(
        loose,
        parseQuery(loose, queryRequestSchema.validate({}).value),
      );

      expect(collection.find.mock.calls.at(-1)[0]).toEqual({
        $and: [
          { eventType: { $in: ["case.create", "case.update.status", null] } },
        ],
      });
      expect(result.plan).toMatchObject({
        kind: "bounded",
        residual: ["eventType"],
      });
    });

    it("does not log", async () => {
      makeCollection();

      await runQuery(bucket, parse({}));

      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("a bounded read", () => {
    const body = { where: { status: "COMPLETED", grantCode: "example-grant" } };

    it("finds the edge of the budget from index keys, then reads within it", async () => {
      const edge = {
        _id: id(7),
        publicationDate: new Date("2026-09-03T10:12:00Z"),
      };
      const collection = makeCollection({ finds: [[edge], []] });

      const result = await runQuery(bucket, parse(body));

      const hint = { status: 1, publicationDate: -1, _id: -1 };
      const sort = { publicationDate: -1, _id: -1 };

      expect(collection.find).toHaveBeenNthCalledWith(
        1,
        { $and: [{ status: "COMPLETED" }] },
        {
          hint,
          sort,
          projection: { publicationDate: 1, _id: 1 },
          skip: SCAN_BUDGET - 1,
          limit: 1,
          maxTimeMS: 5000,
        },
      );
      expect(collection.find).toHaveBeenNthCalledWith(
        2,
        {
          $and: [
            { status: "COMPLETED" },
            { grantCode: "example-grant" },
            { publicationDate: { $gte: edge.publicationDate } },
            {
              $nor: [
                {
                  publicationDate: edge.publicationDate,
                  _id: { $lt: edge._id },
                },
              ],
            },
          ],
        },
        expect.objectContaining({ hint, sort, limit: 21 }),
      );
      expect(result).toMatchObject({
        plan: {
          kind: "bounded",
          index: ["status", "publicationDate", "_id"],
          bound: ["status"],
          filled: [],
          residual: ["grantCode"],
          scans: 1,
        },
        rows: [],
        page: {
          next: null,
          keepLooking: cursorOf(edge),
          searchedTo: "2026-09-03T10:12:00.000Z",
          complete: false,
        },
      });
      expect(collection.countDocuments).not.toHaveBeenCalled();
      expect(queryResponseSchema.validate(result).error).toBeUndefined();
    });

    it("is complete when fewer entries than the budget remain", async () => {
      makeCollection({ finds: [[], [doc(1, { grantCode: "example-grant" })]] });

      const result = await runQuery(bucket, parse(body));

      expect(result.rows).toHaveLength(1);
      expect(result.page).toEqual({
        next: null,
        keepLooking: null,
        searchedTo: null,
        complete: true,
      });
    });

    it("answers next, not keepLooking, for a full page inside the budget", async () => {
      const edge = doc(1);
      makeCollection({ finds: [[edge], [doc(9), doc(8), doc(7)]] });

      const result = await runQuery(bucket, parse({ ...body, limit: 2 }));

      expect(result.page).toEqual({
        next: cursorOf(doc(8)),
        keepLooking: null,
        searchedTo: null,
        complete: false,
      });
    });

    it("counts the budget strictly after a cursor's time", async () => {
      const collection = makeCollection();
      const last = doc(5);

      await runQuery(bucket, parse({ ...body, cursor: cursorOf(last) }));

      expect(collection.find.mock.calls[0][0]).toEqual({
        $and: [
          { status: "COMPLETED" },
          { publicationDate: { $lt: last.publicationDate } },
        ],
      });
      expect(collection.find.mock.calls[1][0].$and).toEqual(
        expect.arrayContaining([
          { publicationDate: { $lte: last.publicationDate } },
          {
            $nor: [
              {
                publicationDate: last.publicationDate,
                _id: { $gte: last._id },
              },
            ],
          },
        ]),
      );
    });

    it("leaves null out of a filled list in the edge read only", async () => {
      const collection = makeCollection();

      await runQuery(
        bucket,
        parse({ where: { eventType: "case.create", grantCode: "example" } }),
      );

      const [[edgeFilter], [pageFilter]] = collection.find.mock.calls;
      const filledOf = (filter) =>
        filter.$and.find((part) => part.status).status.$in;

      expect(filledOf(edgeFilter)).toHaveLength(7);
      expect(filledOf(edgeFilter)).not.toContain(null);
      expect(filledOf(pageFilter)).toHaveLength(8);
      expect(filledOf(pageFilter)).toContain(null);
    });

    it("tests the asked facts on rows behind a ref", async () => {
      const collection = makeCollection();

      const result = await runQuery(
        bucket,
        parse({ ref: "msg:abc", where: { status: "PURGED" } }),
      );

      expect(collection.find.mock.calls[0][0]).toEqual({
        $and: [{ refs: "msg:abc" }],
      });
      expect(collection.find.mock.calls[1][0]).toEqual({
        $and: [{ refs: "msg:abc" }, { status: "PURGED" }],
      });
      expect(result.plan).toMatchObject({
        kind: "bounded",
        bound: ["ref"],
        residual: ["status"],
        scans: 1,
      });
      expect(result.page.complete).toBe(true);
    });

    it("logs the facts asked and the line that led, never a value", async () => {
      makeCollection();

      await runQuery(bucket, parse(body));
      await runQuery(bucket, parse({ ref: "msg:abc", where: { status: "X" } }));

      expect(logger.info).toHaveBeenNthCalledWith(
        1,
        "Bucket test.outbox bounded read: asked [status, grantCode], lead [status]",
      );
      expect(logger.info).toHaveBeenNthCalledWith(
        2,
        "Bucket test.outbox bounded read: asked [status], lead [refs]",
      );
    });
  });

  describe("groups", () => {
    it("counts each value with the group's own filter left out", async () => {
      const collection = makeCollection({ count: 3 });

      const result = await runQuery(
        bucket,
        parse({
          where: { status: "DEAD_LETTER", eventType: "case.create" },
          groupBy: ["status", "eventType"],
        }),
      );

      const hint = {
        status: 1,
        eventType: 1,
        publicationDate: -1,
        _id: -1,
      };

      expect(collection.countDocuments).toHaveBeenCalledTimes(11);
      expect(collection.countDocuments).toHaveBeenCalledWith(
        {
          $and: [{ status: "PUBLISHED", eventType: "case.create" }],
        },
        { hint, limit: COUNT_CAP + 1, maxTimeMS: 5000 },
      );
      expect(collection.countDocuments).toHaveBeenCalledWith(
        {
          $and: [{ status: "DEAD_LETTER", eventType: "case.update.status" }],
        },
        { hint, limit: COUNT_CAP + 1, maxTimeMS: 5000 },
      );
      expect(result.groups).toEqual([
        {
          by: "status",
          values: [
            "PUBLISHED",
            "PROCESSING",
            "FAILED",
            "RESUBMITTED",
            "COMPLETED",
            "DEAD_LETTER",
            "PURGED",
          ].map((value) => ({ value, count: 3, capped: false })),
          total: { count: 3, capped: false },
        },
        {
          by: "eventType",
          values: [
            { value: "case.create", count: 3, capped: false },
            { value: "case.update.status", count: 3, capped: false },
          ],
          total: { count: 3, capped: false },
        },
      ]);
    });

    it("totals the list with the group's own filter left out, on an exact key", async () => {
      const collection = makeCollection({ count: COUNT_CAP + 1 });

      const result = await runQuery(
        bucket,
        parse({
          where: { status: "DEAD_LETTER", eventType: "case.create" },
          groupBy: ["status", "eventType"],
        }),
      );

      expect(collection.countDocuments).toHaveBeenCalledWith(
        {
          $and: [
            { eventType: "case.create" },
            { status: { $in: expect.arrayContaining(["DEAD_LETTER", null]) } },
          ],
        },
        {
          hint: {
            status: 1,
            eventType: 1,
            publicationDate: -1,
            _id: -1,
          },
          limit: COUNT_CAP + 1,
          maxTimeMS: 5000,
        },
      );
      expect(collection.countDocuments).toHaveBeenCalledWith(
        { $and: [{ status: "DEAD_LETTER" }] },
        {
          hint: { status: 1, publicationDate: -1, _id: -1 },
          limit: COUNT_CAP + 1,
          maxTimeMS: 5000,
        },
      );
      expect(result.groups.map(({ total }) => total)).toEqual([
        { count: 10_000, capped: true },
        { count: 10_000, capped: true },
      ]);
    });

    it("fills the other facts of the line when only the group is bound", async () => {
      const collection = makeCollection();

      await runQuery(bucket, parse({ groupBy: ["eventType"] }));

      expect(collection.countDocuments).toHaveBeenCalledWith(
        {
          $and: [
            { eventType: "case.create" },
            { status: { $in: expect.arrayContaining(["PUBLISHED", null]) } },
          ],
        },
        expect.any(Object),
      );
    });

    it("answers null values when the group's plan is not exact", async () => {
      const collection = makeCollection();

      const result = await runQuery(
        bucket,
        parse({
          where: { grantCode: "example-grant" },
          groupBy: ["status", "eventType"],
        }),
      );

      expect(result.groups).toEqual([
        { by: "status", values: null, total: null },
        { by: "eventType", values: null, total: null },
      ]);
      expect(collection.countDocuments).not.toHaveBeenCalled();
    });

    it("answers null values behind a ref", async () => {
      makeCollection();

      const result = await runQuery(
        bucket,
        parse({ ref: "msg:abc", groupBy: ["status"] }),
      );

      expect(result.groups).toEqual([
        { by: "status", values: null, total: { count: 0, capped: false } },
      ]);
    });

    it("reads a stored fact's values from its leading line", async () => {
      const collection = makeCollection({
        count: 2,
        groups: [{ _id: "beta" }, { _id: null }, { _id: "alpha" }],
      });

      const result = await runQuery(bucket, parse({ groupBy: ["code"] }));

      expect(collection.aggregate).toHaveBeenCalledExactlyOnceWith(
        [{ $group: { _id: "$code" } }, { $limit: MAX_VALUES + 1 }],
        {
          hint: { code: 1, publicationDate: -1, _id: -1 },
          maxTimeMS: 5000,
        },
      );
      expect(result.groups).toEqual([
        {
          by: "code",
          values: [
            { value: "alpha", count: 2, capped: false },
            { value: "beta", count: 2, capped: false },
          ],
          total: { count: 2, capped: false },
        },
      ]);
    });

    it("answers null values for a stored fact with too many values", async () => {
      makeCollection({
        groups: Array.from({ length: MAX_VALUES + 1 }, (_, n) => ({
          _id: `code-${n}`,
        })),
      });

      const result = await runQuery(bucket, parse({ groupBy: ["code"] }));

      expect(result.groups).toEqual([
        { by: "code", values: null, total: { count: 0, capped: false } },
      ]);
    });
  });

  it("builds no filter that holds $or", async () => {
    const collection = makeCollection({
      finds: [[doc(1)], []],
      groups: [{ _id: "alpha" }],
    });
    const cursor = cursorOf(doc(9));
    const range = { from: "2026-10-01T00:00:00Z", to: "2026-10-09T00:00:00Z" };
    const bodies = [
      {},
      { cursor, ...range },
      { where: { eventType: "case.create" }, cursor },
      { where: { status: "FAILED", grantCode: "x" }, cursor, ...range },
      { where: { eventType: "case.create", grantCode: "x" }, cursor },
      { ref: "msg:abc", cursor },
      { ref: "msg:abc", where: { status: "PURGED" }, cursor },
      { groupBy: ["status", "eventType", "code"] },
    ];

    for (const body of bodies) {
      await runQuery(bucket, parse(body));
    }

    const filters = [
      ...collection.find.mock.calls,
      ...collection.countDocuments.mock.calls,
    ].map(([filter]) => filter);

    expect(filters.length).toBeGreaterThan(bodies.length);
    expect(filters.filter(holdsOr)).toEqual([]);
    expect(holdsOr(collection.aggregate.mock.calls)).toBe(false);
  });

  describe("the deadline", () => {
    it("gives each read the time left, never less than 1", async () => {
      const collection = makeCollection();

      collection.find.mockImplementationOnce(() => ({
        toArray: async () => {
          vi.setSystemTime(Date.now() + 1200);
          return [];
        },
      }));
      collection.find.mockImplementationOnce(() => ({
        toArray: async () => {
          vi.setSystemTime(Date.now() + 9000);
          return [];
        },
      }));

      await runQuery(
        bucket,
        parse({ where: { status: "COMPLETED", grantCode: "x" } }),
      );
      await runQuery(bucket, parse({}));

      const limits = collection.find.mock.calls.map(
        ([, options]) => options.maxTimeMS,
      );

      expect(limits).toEqual([5000, 3800, 5000]);

      vi.setSystemTime(Date.now() + 1);
      collection.find.mockImplementationOnce(() => ({
        toArray: async () => {
          vi.setSystemTime(Date.now() + 9000);
          return [];
        },
      }));

      await runQuery(
        bucket,
        parse({ where: { status: "COMPLETED", grantCode: "x" } }),
      );

      expect(collection.find.mock.calls.at(-1)[1].maxTimeMS).toBe(1);
    });

    it.each([
      ["the page read", (collection) => collection.find],
      ["the count", (collection) => collection.countDocuments],
      ["the stored values read", (collection) => collection.aggregate],
    ])("refuses TIMED_OUT when the server stops %s", async (_, pick) => {
      const collection = makeCollection();

      pick(collection).mockImplementation(() => ({
        toArray: () => Promise.reject(timedOut()),
        then: (_resolve, reject) => reject(timedOut()),
        catch: (handle) => Promise.reject(timedOut()).catch(handle),
      }));

      await expect(
        runQuery(bucket, parse({ groupBy: ["code"] })),
      ).rejects.toThrow(reasonOf("TIMED_OUT"));
    });

    it("passes any other failure on", async () => {
      const collection = makeCollection();
      const failure = new Error("connection closed");

      collection.find.mockReturnValue({
        toArray: () => Promise.reject(failure),
      });

      await expect(runQuery(bucket, parse({}))).rejects.toBe(failure);
    });
  });
});

describe("readTimeline", () => {
  const timelineBucket = (id, label, order) =>
    testBucket({ id, label, order, timeline: true });

  beforeEach(() => {
    clearBuckets();
    registerBucket(timelineBucket("test.inbox", "Test inbox", 20));
    registerBucket(timelineBucket("test.outbox", "Test outbox", 10));
    registerBucket(testBucket({ id: "test.records", order: 30 }));
  });

  afterEach(() => {
    clearBuckets();
  });

  it("searches the ref in every timeline bucket registered, 50 from each, and no other", async () => {
    const collection = makeCollection({ finds: [[doc(2), doc(1)], []] });

    const { buckets } = await readTimeline("ref:ABC-123");

    expect(collection.find).toHaveBeenCalledTimes(2);
    expect(collection.find.mock.calls[0]).toEqual([
      { $and: [{ refs: "ref:abc-123" }] },
      expect.objectContaining({
        hint: { refs: 1, publicationDate: -1, _id: -1 },
        limit: 51,
      }),
    ]);
    expect(buckets).toEqual([
      {
        id: "test.outbox",
        label: "Test outbox",
        rows: [
          expect.objectContaining({ id: String(id(2)) }),
          expect.objectContaining({ id: String(id(1)) }),
        ],
        more: false,
      },
      { id: "test.inbox", label: "Test inbox", rows: [], more: false },
    ]);
    expect(timelineResponseSchema.validate({ buckets }).error).toBeUndefined();
  });

  it("reads by a link longer than a searched ref may be", async () => {
    clearBuckets();
    registerBucket(
      testBucket({
        id: "test.outbox",
        label: "Test outbox",
        timeline: true,
        links: ["case"],
      }),
    );
    const collection = makeCollection({ finds: [[doc(1)]] });
    const link = `case:w:${"~41.".repeat(70)}`;

    const { buckets } = await readTimeline(link);

    expect(collection.find.mock.calls[0][0]).toEqual({
      $and: [{ refs: link }],
    });
    expect(buckets[0].rows).toHaveLength(1);
  });

  it("says a bucket has more when its page has a next", async () => {
    makeCollection({
      finds: [Array.from({ length: 51 }, (_, n) => doc(60 - n)), []],
    });

    const { buckets } = await readTimeline("ref:abc-123");

    expect(buckets.map(({ rows, more }) => [rows.length, more])).toEqual([
      [50, true],
      [0, false],
    ]);
  });

  it("answers null rows for a bucket that fails, keeps the rest, and logs no value", async () => {
    const collection = makeCollection();

    collection.find
      .mockImplementationOnce(() => ({
        toArray: vi.fn(async () => {
          throw new Error("SECRET ref:abc-123");
        }),
      }))
      .mockImplementationOnce(() => ({ toArray: vi.fn(async () => [doc(1)]) }));

    const { buckets } = await readTimeline("ref:abc-123");

    expect(
      buckets.map(({ id: bucketId, rows }) => [bucketId, rows?.length]),
    ).toEqual([
      ["test.outbox", undefined],
      ["test.inbox", 1],
    ]);
    expect(buckets[0].rows).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      "Timeline: test.outbox could not be read (Error)",
    );
  });

  it("answers null rows for a bucket that does not declare the ref's kind", async () => {
    makeCollection();

    const { buckets } = await readTimeline("sbi:900000005");

    expect(buckets.map(({ rows }) => rows)).toEqual([null, null]);
  });
});

describe("readBucketTimeline", () => {
  beforeEach(() => {
    clearBuckets();
    registerBucket(
      testBucket({
        id: "test.inbox",
        label: "Test inbox",
        timeline: true,
        links: ["config"],
      }),
    );
    registerBucket(
      testBucket({ id: "test.outbox", label: "Test outbox", timeline: true }),
    );
  });

  afterEach(() => {
    clearBuckets();
  });

  it("reads the link in that bucket alone, 50 at most", async () => {
    const collection = makeCollection({ finds: [[doc(2), doc(1)]] });

    const { buckets } = await readBucketTimeline(
      "test.inbox",
      "config:woodland-creation",
    );

    expect(collection.find).toHaveBeenCalledExactlyOnceWith(
      { $and: [{ refs: "config:woodland-creation" }] },
      expect.objectContaining({ limit: 51 }),
    );
    expect(buckets).toEqual([
      {
        id: "test.inbox",
        label: "Test inbox",
        rows: [
          expect.objectContaining({ id: String(id(2)) }),
          expect.objectContaining({ id: String(id(1)) }),
        ],
        more: false,
      },
    ]);
    expect(timelineResponseSchema.validate({ buckets }).error).toBeUndefined();
  });

  it("says the bucket has more when its page has a next", async () => {
    makeCollection({
      finds: [Array.from({ length: 51 }, (_, n) => doc(60 - n))],
    });

    const { buckets } = await readBucketTimeline("test.inbox", "config:abc");

    expect(buckets.map(({ rows, more }) => [rows.length, more])).toEqual([
      [50, true],
    ]);
  });

  it("answers null rows when the bucket fails", async () => {
    const collection = makeCollection();

    collection.find.mockImplementationOnce(() => ({
      toArray: vi.fn(async () => {
        throw new Error("connection closed");
      }),
    }));

    const { buckets } = await readBucketTimeline("test.inbox", "config:abc");

    expect(buckets).toEqual([
      { id: "test.inbox", label: "Test inbox", rows: null, more: false },
    ]);
  });
});

describe("describeBucket", () => {
  it("answers the catalogue entry with stored values read", async () => {
    const collection = makeCollection({
      groups: [{ _id: "beta" }, { _id: "alpha" }, { _id: null }],
    });

    const entry = await describeBucket(bucket);

    expect(collection.aggregate).toHaveBeenCalledExactlyOnceWith(
      expect.any(Array),
      {
        hint: { code: 1, publicationDate: -1, _id: -1 },
        maxTimeMS: 5000,
      },
    );
    expect(entry).toEqual({
      id: "test.outbox",
      path: "test/outbox",
      label: "Test outbox",
      service: "Test",
      shortLabel: "Outbox",
      icon: null,
      order: 10,
      noun: { one: "event", many: "events" },
      time: { label: "Created" },
      facts: [
        {
          name: "status",
          param: "status",
          label: "Status",
          values: bucket.facts.status.values,
          toggle: null,
          within: null,
        },
        {
          name: "eventType",
          param: "event",
          label: "Event",
          values: bucket.facts.eventType.values,
          toggle: null,
          within: null,
        },
        {
          name: "grantCode",
          param: "grant",
          label: "Grant",
          values: null,
          toggle: null,
          within: null,
        },
        {
          name: "code",
          param: "code",
          label: "Code",
          values: [
            { value: "alpha", label: "alpha" },
            { value: "beta", label: "beta" },
          ],
          toggle: null,
          within: null,
        },
        {
          name: "source",
          param: "source",
          label: "Source",
          values: bucket.facts.source.values,
          toggle: null,
          within: null,
        },
      ],
      refs: [
        { kind: "ref", label: "Reference" },
        { kind: "msg", label: "Message id" },
      ],
      indexes: [[], ["status"], ["status", "eventType"], ["code"]],
      groupings: ["status", "eventType", "code"],
      title: { label: "Event", format: "eventType" },
      columns: bucket.columns,
      audited: false,
      timeline: false,
      summaries: [],
      page: null,
      tab: null,
    });
  });

  it("describes a toggle and its hidden values, and puts the lead in every index line", async () => {
    const entry = await describeBucket(ledBucket());

    expect(entry.facts[0]).toEqual({
      name: "eventType",
      param: "event",
      label: "Event",
      values: [
        { value: "case.create", label: "case.create" },
        { value: "case.update.status", label: "case.update.status" },
        { value: "audit", label: "audit", hidden: true },
      ],
      toggle: { label: "Show audit events", param: "audit" },
      within: null,
    });
    expect(entry.indexes).toEqual([["eventType"], ["eventType", "status"]]);
    expect(catalogueEntrySchema.validate(entry).error).toBeUndefined();
  });

  it("describes no toggle on a fact that hides nothing", async () => {
    const { eventType, status, grantCode } = ledBucket().facts;
    const open = ledBucket({
      facts: {
        eventType: { ...eventType, values: eventType.values.slice(0, 2) },
        status,
        grantCode,
      },
    });

    const entry = await describeBucket(open);

    expect(entry.facts[0].toggle).toBeNull();
  });

  it("describes the fact a fact is within", async () => {
    makeCollection({ groups: [{ _id: "alpha" }] });
    const within = testBucket({
      facts: {
        ...bucket.facts,
        version: { label: "Version", param: "version", within: "code" },
      },
      indexes: [...bucket.indexes, ["code", "version"]],
    });

    const entry = await describeBucket(within);

    expect(entry.facts.find(({ name }) => name === "version")).toEqual({
      name: "version",
      param: "version",
      label: "Version",
      values: null,
      toggle: null,
      within: "code",
    });
    expect(catalogueEntrySchema.validate(entry).error).toBeUndefined();
  });

  it("describes a stored fact with too many values as open and not a grouping", async () => {
    makeCollection({
      groups: Array.from({ length: MAX_VALUES + 1 }, (_, n) => ({
        _id: `code-${n}`,
      })),
    });

    const entry = await describeBucket(bucket);

    expect(entry.facts.find(({ name }) => name === "code").values).toBeNull();
    expect(entry.groupings).toEqual(["status", "eventType"]);
  });

  it("reads nothing for a bucket with no stored fact", async () => {
    const collection = makeCollection();
    const closed = testBucket({
      indexes: [["status"]],
      groupings: ["status"],
      facts: { status: bucket.facts.status },
    });

    await describeBucket(closed);

    expect(collection.aggregate).not.toHaveBeenCalled();
  });
});

describe("ensureIndexes", () => {
  const makeDatabase = (existing) => {
    const collection = {
      collectionName: "outbox",
      indexes: vi.fn(async () => existing),
      createIndex: vi.fn(async (key) => Object.keys(key).join("_")),
    };

    return { collection, database: { collection: vi.fn(() => collection) } };
  };

  it("builds every key that no index has, under the driver's name", async () => {
    const { collection, database } = makeDatabase([
      { name: "_id_", key: { _id: 1 } },
    ]);

    await ensureIndexes(database, bucket);

    expect(database.collection).toHaveBeenCalledWith("outbox");
    expect(collection.indexes).toHaveBeenCalledWith({
      readPreference: "primary",
    });
    expect(collection.createIndex.mock.calls).toEqual([
      [{ publicationDate: -1, _id: -1 }],
      [{ status: 1, publicationDate: -1, _id: -1 }],
      [{ status: 1, eventType: 1, publicationDate: -1, _id: -1 }],
      [{ code: 1, publicationDate: -1, _id: -1 }],
      [{ refs: 1, publicationDate: -1, _id: -1 }],
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Bucket index publicationDate__id on outbox built in \d+ms$/,
      ),
    );
  });

  it("keeps an index with the same key under any name", async () => {
    const { collection, database } = makeDatabase([
      {
        name: "list_by_status",
        key: { status: 1, publicationDate: -1, _id: -1 },
      },
    ]);

    await ensureIndexes(database, bucket);

    expect(collection.createIndex).toHaveBeenCalledTimes(4);
    expect(collection.createIndex).not.toHaveBeenCalledWith({
      status: 1,
      publicationDate: -1,
      _id: -1,
    });
    expect(logger.info).toHaveBeenCalledWith(
      "Bucket index list_by_status on outbox exists",
    );
  });

  it("does not take an index with the same fields in another order", async () => {
    const { collection, database } = makeDatabase([
      {
        name: "other",
        key: { publicationDate: -1, status: 1, _id: -1 },
      },
    ]);

    await ensureIndexes(database, bucket);

    expect(collection.createIndex).toHaveBeenCalledTimes(5);
  });

  it.each([
    ["partial", { partialFilterExpression: { status: "FAILED" } }],
    ["sparse", { sparse: true }],
    ["hidden", { hidden: true }],
    ["collated", { collation: { locale: "en" } }],
  ])("throws when the existing index is %s", async (_, option) => {
    const { database } = makeDatabase([
      {
        name: "odd",
        key: { publicationDate: -1, _id: -1 },
        ...option,
      },
    ]);

    await expect(ensureIndexes(database, bucket)).rejects.toThrow(
      "Index odd on outbox is not a plain index",
    );
  });

  it("builds every key when the collection does not exist yet", async () => {
    const { collection, database } = makeDatabase([]);

    collection.indexes.mockRejectedValue(
      Object.assign(new Error("ns does not exist"), { code: 26 }),
    );

    await ensureIndexes(database, bucket);

    expect(collection.createIndex).toHaveBeenCalledTimes(5);
  });

  it("passes any other failure on", async () => {
    const { collection, database } = makeDatabase([]);
    const failure = new Error("not authorised");

    collection.indexes.mockRejectedValue(failure);

    await expect(ensureIndexes(database, bucket)).rejects.toBe(failure);
  });
});

describe("a summary", () => {
  const summary = {
    id: "errors",
    label: "Errors",
    by: ["grantCode"],
    among: { status: "DEAD_LETTER" },
    top: 2,
    none: "None recorded",
  };
  const summarised = ledBucket({
    indexes: [["status"], ["status", "grantCode"]],
    summaries: [summary],
  });
  const hint = {
    eventType: 1,
    status: 1,
    grantCode: 1,
    publicationDate: -1,
    _id: -1,
  };
  const everyType = {
    $in: ["case.create", "case.update.status", "audit", null],
  };
  const parseIt = (body) =>
    parseSummary(
      summarised,
      "errors",
      summaryRequestSchema.validate(body).value,
    );
  const summarise = (body = {}) => runSummary(summarised, parseIt(body));
  const shown = { show: ["eventType"] };
  const counting = (collection, counts) =>
    collection.countDocuments.mockImplementation(
      async ({ $and: [{ grantCode }] }) => counts[grantCode],
    );

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-10-09T12:00:00.000Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses a summary the bucket does not declare", () => {
    expect(() => parseSummary(summarised, "nothing", {})).toThrow(
      reasonOf("UNKNOWN_SUMMARY"),
    );
    expect(() => parseSummary(bucket, "errors", {})).toThrow(
      reasonOf("UNKNOWN_SUMMARY"),
    );
  });

  it("refuses a range that ends before it starts", () => {
    expect(() =>
      parseIt({
        from: "2026-10-09T00:00:00.000Z",
        to: "2026-10-08T00:00:00.000Z",
      }),
    ).toThrow(reasonOf("INVALID_RANGE"));
  });

  it("refuses to show a fact the bucket does not declare", () => {
    expect(() => parseIt({ show: ["colour"] })).toThrow(
      reasonOf("UNKNOWN_FACT"),
    );
  });

  it("leaves the hidden value out of its scans and counts until it is shown", async () => {
    const collection = makeCollection({
      groups: [{ _id: "alpha" }],
      count: 1,
    });

    await summarise();

    expect(collection.aggregate.mock.calls.map(([[stage]]) => stage)).toEqual(
      ["case.create", "case.update.status", null].map((eventType) => ({
        $match: { eventType, status: "DEAD_LETTER" },
      })),
    );
    expect(collection.countDocuments.mock.calls[0][0].$and[1]).toEqual({
      eventType: { $in: ["case.create", "case.update.status", null] },
    });
  });

  it("finds the distinct values with one stepping scan per filled value within the range, the hidden one too once shown", async () => {
    const collection = makeCollection({ groups: [{ _id: "alpha" }] });
    const since = { $gte: new Date("2026-10-08T00:00:00.000Z") };

    await summarise({ ...shown, from: "2026-10-08T00:00:00.000Z" });

    expect(collection.aggregate).toHaveBeenCalledTimes(4);
    expect(collection.aggregate.mock.calls.map(([[stage]]) => stage)).toEqual(
      ["case.create", "case.update.status", "audit", null].map((eventType) => ({
        $match: { eventType, status: "DEAD_LETTER", publicationDate: since },
      })),
    );
    expect(collection.aggregate).toHaveBeenCalledWith(
      [
        {
          $match: {
            eventType: "audit",
            status: "DEAD_LETTER",
            publicationDate: since,
          },
        },
        { $group: { _id: "$grantCode" } },
        { $limit: MAX_VALUES + 1 },
      ],
      { hint, maxTimeMS: 5000 },
    );
  });

  it("counts each value on the summary's line within the range, and reads when it was first and last seen", async () => {
    const collection = makeCollection({
      groups: [{ _id: "alpha" }],
      count: 3,
      finds: [
        [{ publicationDate: new Date("2026-10-01T08:00:00.000Z") }],
        [{ publicationDate: new Date("2026-10-09T09:00:00.000Z") }],
      ],
    });
    const filter = {
      $and: [
        { status: "DEAD_LETTER", grantCode: "alpha" },
        { eventType: everyType },
        { publicationDate: { $gte: new Date("2026-10-08T00:00:00.000Z") } },
      ],
    };

    const result = await summarise({
      ...shown,
      from: "2026-10-08T00:00:00.000Z",
    });

    expect(collection.countDocuments).toHaveBeenCalledExactlyOnceWith(filter, {
      hint,
      limit: SUMMARY_COUNT_CAP + 1,
      maxTimeMS: 5000,
    });
    expect(collection.find).toHaveBeenCalledTimes(2);
    expect(collection.find).toHaveBeenNthCalledWith(1, filter, {
      hint,
      maxTimeMS: 5000,
      sort: { publicationDate: 1, _id: 1 },
      projection: { publicationDate: 1, _id: 0 },
      limit: 1,
    });
    expect(collection.find).toHaveBeenNthCalledWith(2, filter, {
      hint,
      maxTimeMS: 5000,
      sort: { publicationDate: -1, _id: -1 },
      projection: { publicationDate: 1, _id: 0 },
      limit: 1,
    });
    expect(result).toEqual({
      bucket: "test.outbox",
      summary: "errors",
      entries: [
        {
          values: { grantCode: "alpha" },
          count: 3,
          capped: false,
          firstAt: "2026-10-01T08:00:00.000Z",
          lastAt: "2026-10-09T09:00:00.000Z",
        },
      ],
      more: false,
      complete: true,
    });
    expect(summaryResponseSchema.validate(result).error).toBeUndefined();
  });

  it("answers the most frequent first, as many as it declares, and says more were left off", async () => {
    const collection = makeCollection({
      groups: [{ _id: "beta" }, { _id: "alpha" }, { _id: "gamma" }],
    });
    counting(collection, { alpha: 2, beta: SUMMARY_COUNT_CAP + 1, gamma: 2 });

    const result = await summarise();

    expect(result.entries).toEqual([
      {
        values: { grantCode: "beta" },
        count: 100_000,
        capped: true,
        firstAt: null,
        lastAt: null,
      },
      {
        values: { grantCode: "alpha" },
        count: 2,
        capped: false,
        firstAt: null,
        lastAt: null,
      },
    ]);
    expect(result.more).toBe(true);
  });

  it("keeps the rows that hold no value as an entry of their own, and leaves out a value with none in the range", async () => {
    const collection = makeCollection({
      groups: [{ _id: null }, { _id: "alpha" }],
    });
    counting(collection, { alpha: 0, null: 5 });

    const result = await summarise();

    expect(
      collection.countDocuments.mock.calls.map(([filter]) => filter.$and[0]),
    ).toContainEqual({ status: "DEAD_LETTER", grantCode: null });
    expect(result.entries).toEqual([
      {
        values: { grantCode: null },
        count: 5,
        capped: false,
        firstAt: null,
        lastAt: null,
      },
    ]);
    expect(result.more).toBe(false);
    expect(summaryResponseSchema.validate(result).error).toBeUndefined();
  });

  it("counts no more distinct values than its cap, and says it is incomplete", async () => {
    const collection = makeCollection({
      groups: Array.from({ length: MAX_VALUES + 1 }, (_, n) => ({
        _id: `name-${String(n).padStart(3, "0")}`,
      })),
      count: 1,
    });

    const result = await summarise();

    expect(collection.countDocuments).toHaveBeenCalledTimes(MAX_VALUES);
    expect(result.complete).toBe(false);
  });

  it("counts each combination of several facts, a lead fact taken from each fill and the others stepped one at a time", async () => {
    const twoFacts = ledBucket({
      indexes: [["status"], ["status", "grantCode"]],
      summaries: [{ ...summary, by: ["grantCode", "eventType"], top: 20 }],
    });
    const collection = makeCollection({
      groups: [{ _id: "alpha" }],
      count: 1,
    });

    const result = await runSummary(
      twoFacts,
      parseSummary(twoFacts, "errors", summaryRequestSchema.validate({}).value),
    );

    expect(collection.aggregate).toHaveBeenCalledWith(
      [
        { $match: { eventType: "case.create", status: "DEAD_LETTER" } },
        { $group: { _id: "$grantCode" } },
        { $limit: MAX_VALUES + 1 },
      ],
      { hint, maxTimeMS: 5000 },
    );
    expect(collection.countDocuments.mock.calls[0][0].$and[0]).toEqual({
      status: "DEAD_LETTER",
      grantCode: "alpha",
      eventType: "case.create",
    });
    expect(result.entries.map(({ values }) => values)).toEqual([
      { grantCode: "alpha", eventType: "case.create" },
      { grantCode: "alpha", eventType: "case.update.status" },
      { grantCode: "alpha", eventType: null },
    ]);
    expect(summaryResponseSchema.validate(result).error).toBeUndefined();
  });

  it("refuses TIMED_OUT when a scan runs out of time", async () => {
    const collection = makeCollection();
    collection.aggregate.mockReturnValue({
      toArray: () => Promise.reject(timedOut()),
    });

    await expect(summarise()).rejects.toThrow(reasonOf("TIMED_OUT"));
  });

  it("is carried by the catalogue entry", async () => {
    makeCollection();

    const entry = await describeBucket(summarised);

    expect(entry.summaries).toEqual([summary]);
    expect(catalogueEntrySchema.validate(entry).error).toBeUndefined();
  });
});
