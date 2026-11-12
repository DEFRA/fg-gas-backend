import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../logger.js";
import { db } from "../mongo-client.js";
import {
  clearSearchSources,
  defineSearchSource,
  registerSearchSource,
} from "../search/source.js";
import { describeBucket } from "./catalogue.js";
import { encodeCursor } from "./cursor.js";
import { parseQuery, prepareQuery, runQuery } from "./engine.js";
import {
  catalogueEntrySchema,
  queryRequestSchema,
  queryResponseSchema,
} from "./schema.js";
import { searchedBucket } from "./search-test-bucket.js";
import { testBucket } from "./test-bucket.js";

vi.mock("../logger.js");
vi.mock("../mongo-client.js", () => ({ db: { collection: vi.fn() } }));

const bucket = searchedBucket();

const declarations = [
  {
    value: "grant-a",
    search: {
      fields: [
        {
          key: "businessName",
          label: "Business name",
          path: "$.answers.business.name",
          match: "prefix",
        },
        { key: "parcelId", label: "Parcel ID", path: "$.answers.parcel" },
      ],
    },
  },
  { value: "grant-b", search: null },
];

const id = (n) =>
  ObjectId.createFromHexString(n.toString(16).padStart(24, "0"));

const at = (n) => new Date(Date.UTC(2026, 9, 9, 9, 0, n)).toISOString();

const hit = (n) => ({ _id: id(n), createdAt: at(n) });

const record = (n) => ({
  _id: id(n),
  createdAt: at(n),
  eventType: "case.create",
  status: "COMPLETED",
});

const valid = (body) => queryRequestSchema.validate(body).value;

const parse = (body, from = bucket) => parseQuery(from, valid(body));

const prepare = (body, from = bucket) => prepareQuery(from, valid(body));

const reasonOf = (reason) =>
  expect.objectContaining({
    output: expect.objectContaining({
      payload: expect.objectContaining({ reason }),
    }),
  });

const timedOut = () => Object.assign(new Error("timed out"), { code: 50 });

const makeCollection = (finds) => {
  const pending = [...finds];
  const collection = {
    find: vi.fn(() => ({
      toArray: vi.fn(async () => (pending.length ? pending.shift() : [])),
    })),
    countDocuments: vi.fn(),
    aggregate: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
  };

  db.collection.mockReturnValue(collection);

  return collection;
};

beforeEach(() => {
  registerSearchSource(
    defineSearchSource({
      collection: "record_search",
      records: "outbox",
      lead: "code",
      projection: {},
      viewOf: () => ({}),
      listDeclarations: async () => declarations,
    }),
  );
});

afterEach(() => {
  clearSearchSources();
});

describe("parseQuery with a field", () => {
  it("normalises the value and leaves its match to the declaration", () => {
    expect(
      parse({ where: { code: "grant-a" }, field: "businessName:O’Neill Farm" }),
    ).toMatchObject({
      where: { code: "grant-a" },
      asked: ["code"],
      field: { key: "businessName", match: null, value: "oneillfarm" },
      plan: { kind: "exact", line: "field", filled: [], residual: [] },
    });
  });

  it("splits on the first colon", () => {
    expect(
      parse({ where: { code: "grant-a" }, field: "parcelId:SX:0679" }).field,
    ).toEqual({ key: "parcelId", match: null, value: "sx0679" });
  });

  it.each([
    [
      "a bucket with no search",
      testBucket(),
      { where: { code: "grant-a" }, field: "businessName:x" },
      "UNKNOWN_FIELD",
    ],
    ["no lead value", bucket, { field: "businessName:x" }, "FIELD_NEEDS_LEAD"],
    [
      "another fact",
      bucket,
      { where: { status: "COMPLETED" }, field: "businessName:x" },
      "FIELD_NEEDS_LEAD",
    ],
    [
      "another fact beside the lead",
      bucket,
      { where: { code: "grant-a", status: "COMPLETED" }, field: "a:x" },
      "FIELD_WITH_FILTER",
    ],
    [
      "a ref",
      bucket,
      { where: { code: "grant-a" }, ref: "ref:abc", field: "a:x" },
      "FIELD_WITH_FILTER",
    ],
    [
      "no key",
      bucket,
      { where: { code: "grant-a" }, field: ":x" },
      "UNKNOWN_FIELD",
    ],
    [
      "no colon",
      bucket,
      { where: { code: "grant-a" }, field: "businessName" },
      "UNKNOWN_FIELD",
    ],
    [
      "a value with no letters or digits",
      bucket,
      { where: { code: "grant-a" }, field: "businessName: -'’ " },
      "INVALID_FIELD_VALUE",
    ],
    [
      "a value over 200 characters",
      bucket,
      { where: { code: "grant-a" }, field: `parcelId:${"a".repeat(201)}` },
      "INVALID_FIELD_VALUE",
    ],
  ])("refuses %s", (_, from, body, reason) => {
    expect(() => parse(body, from)).toThrow(reasonOf(reason));
  });

  it("accepts a value of 200 characters", () => {
    expect(
      parse({
        where: { code: "grant-a" },
        field: `parcelId:${"a".repeat(200)}`,
      }).field.value,
    ).toHaveLength(200);
  });
});

describe("prepareQuery", () => {
  it("takes the field's match from its code's declaration", async () => {
    expect(
      (await prepare({ where: { code: "grant-a" }, field: "businessName:Hil" }))
        .field,
    ).toEqual({ key: "businessName", match: "prefix", value: "hil" });
    expect(
      (await prepare({ where: { code: "grant-a" }, field: "parcelId:S" }))
        .field,
    ).toEqual({ key: "parcelId", match: "exact", value: "s" });
  });

  it("answers a query with no field as parsed", async () => {
    expect(await prepare({ where: { code: "grant-a" } })).toEqual(
      parse({ where: { code: "grant-a" } }),
    );
  });

  it.each([
    [
      "a key the code does not declare",
      "grant-a",
      "postcode:AB1",
      "UNKNOWN_FIELD",
    ],
    [
      "a code that declares nothing",
      "grant-b",
      "businessName:abc",
      "UNKNOWN_FIELD",
    ],
    ["a code nobody published", "grant-c", "businessName:abc", "UNKNOWN_FIELD"],
    ["an inherited name", "grant-a", "constructor:abc", "UNKNOWN_FIELD"],
    ["a prefix under 3", "grant-a", "businessName:H-i", "FIELD_TOO_SHORT"],
  ])("refuses %s", async (_, code, field, reason) => {
    await expect(prepare({ where: { code }, field })).rejects.toThrow(
      reasonOf(reason),
    );
  });
});

describe("runQuery with a field", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-10-09T12:00:00.000Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads ids from the search table, then their rows in that order", async () => {
    const collection = makeCollection([
      [hit(5), hit(4), hit(3)],
      [record(3), record(5), record(4)],
    ]);
    collection.countDocuments.mockResolvedValue(3);

    const result = await runQuery(
      bucket,
      await prepare({
        where: { code: "grant-a" },
        field: "parcelId:SX 1",
        limit: 2,
        groupBy: ["status"],
      }),
    );

    expect(db.collection.mock.calls).toEqual([
      ["record_search"],
      ["record_search"],
      ["outbox"],
    ]);
    expect(collection.find.mock.calls).toEqual([
      [
        { $and: [{ code: "grant-a", keys: "parcelId:sx1" }] },
        {
          projection: { _id: 1, createdAt: 1 },
          sort: { createdAt: -1, _id: -1 },
          limit: 3,
          maxTimeMS: 5000,
        },
      ],
      [
        { _id: { $in: [id(5), id(4)] } },
        {
          projection: { eventType: 1, status: 1, createdAt: 1 },
          maxTimeMS: 5000,
        },
      ],
    ]);
    expect(result).toEqual({
      bucket: "test.outbox",
      plan: {
        kind: "exact",
        index: ["code", "keys", "createdAt", "_id"],
        bound: ["code", "field"],
        filled: [],
        residual: [],
        scans: 1,
      },
      rows: [
        expect.objectContaining({ id: id(5).toString(), time: at(5) }),
        expect.objectContaining({ id: id(4).toString(), time: at(4) }),
      ],
      page: {
        next: encodeCursor({ t: at(4), i: id(4) }),
        keepLooking: null,
        searchedTo: null,
        complete: false,
      },
      groups: [{ by: "status", values: null, total: null }],
      total: { count: 3, capped: false },
    });
    expect(collection.countDocuments.mock.calls).toEqual([
      [
        { $and: [{ code: "grant-a", keys: "parcelId:sx1" }] },
        { limit: 10_001, maxTimeMS: 5000 },
      ],
    ]);
    expect(queryResponseSchema.validate(result).error).toBeUndefined();
  });

  it("counts a prefix within the time range", async () => {
    const collection = makeCollection([[hit(2)], [record(2)]]);
    collection.countDocuments.mockResolvedValue(1);

    const result = await runQuery(
      bucket,
      await prepare({
        where: { code: "grant-a" },
        field: "businessName:Hill",
        from: "2026-10-01T00:00:00Z",
        to: "2026-10-09T00:00:00Z",
      }),
    );

    expect(collection.countDocuments.mock.calls[0][0]).toEqual({
      $and: [
        { code: "grant-a", keys: { $regex: "^businessName:hill" } },
        {
          createdAt: {
            $gte: "2026-10-01T00:00:00.000Z",
            $lte: "2026-10-09T00:00:00.000Z",
          },
        },
      ],
    });
    expect(result.total).toEqual({ count: 1, capped: false });
  });

  it("stops counting past the cap", async () => {
    const collection = makeCollection([[hit(2)], [record(2)]]);
    collection.countDocuments.mockResolvedValue(10_001);

    const result = await runQuery(
      bucket,
      await prepare({ where: { code: "grant-a" }, field: "parcelId:x" }),
    );

    expect(result.total).toEqual({ count: 10_000, capped: true });
  });

  it("answers the rows with no total when the count runs out of time", async () => {
    const collection = makeCollection([[hit(2)], [record(2)]]);
    collection.countDocuments.mockRejectedValue(timedOut());

    const result = await runQuery(
      bucket,
      await prepare({ where: { code: "grant-a" }, field: "businessName:hil" }),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.total).toBeNull();
    expect(queryResponseSchema.validate(result).error).toBeUndefined();
  });

  it("fails a count without the value searched for", async () => {
    const collection = makeCollection([[hit(2)], [record(2)]]);
    collection.countDocuments.mockRejectedValue(
      Object.assign(new Error("keys regex /^businessName:hilltop/ failed"), {
        code: 2,
        codeName: "BadValue",
      }),
    );

    const error = await runQuery(
      bucket,
      await prepare({
        where: { code: "grant-a" },
        field: "businessName:Hilltop",
      }),
    ).catch((e) => e);

    expect(error).toMatchObject({ message: "Bucket read failed", code: 2 });
    expect(error.message).not.toMatch(/hilltop/i);
  });

  it("answers no total for a read that is not a field search", async () => {
    makeCollection([[record(2)]]);

    const result = await runQuery(
      bucket,
      parse({ where: { code: "grant-a" } }),
    );

    expect(result).not.toHaveProperty("total");
  });

  it("reads a prefix as an anchored range, within the time range, after the cursor, and counts nothing on a later page", async () => {
    const collection = makeCollection([[hit(2)], [record(2)]]);

    const result = await runQuery(
      bucket,
      await prepare({
        where: { code: "grant-a" },
        field: "businessName:Hill.*",
        from: "2026-10-01T00:00:00Z",
        to: "2026-10-09T00:00:00Z",
        cursor: encodeCursor({ t: at(3), i: id(3) }),
      }),
    );

    expect(collection.find.mock.calls[0][0]).toEqual({
      $and: [
        { code: "grant-a", keys: { $regex: "^businessName:hill" } },
        {
          createdAt: {
            $gte: "2026-10-01T00:00:00.000Z",
            $lte: "2026-10-09T00:00:00.000Z",
          },
        },
        { createdAt: { $lte: at(3) } },
        { $nor: [{ createdAt: at(3), _id: { $gte: id(3) } }] },
      ],
    });
    expect(result.page).toEqual({
      next: null,
      keepLooking: null,
      searchedTo: null,
      complete: true,
    });
    expect(collection.countDocuments).not.toHaveBeenCalled();
    expect(result.total).toBeNull();
  });

  it("leaves out a row whose record is gone", async () => {
    makeCollection([[hit(2), hit(1)], [record(1)]]);

    const result = await runQuery(
      bucket,
      await prepare({ where: { code: "grant-a" }, field: "parcelId:x" }),
    );

    expect(result.rows.map(({ id: rowId }) => rowId)).toEqual([
      id(1).toString(),
    ]);
  });

  it("refuses TIMED_OUT when the search read runs out of time", async () => {
    const collection = makeCollection([]);
    collection.find.mockReturnValue({
      toArray: () => Promise.reject(timedOut()),
    });

    await expect(
      runQuery(
        bucket,
        await prepare({
          where: { code: "grant-a" },
          field: "businessName:hil",
        }),
      ),
    ).rejects.toThrow(reasonOf("TIMED_OUT"));
  });

  it("fails a search read without the value searched for, in its error or any log line", async () => {
    const collection = makeCollection([]);
    collection.find.mockReturnValue({
      toArray: () =>
        Promise.reject(
          Object.assign(
            new Error(
              "Error processing query: keys regex /^businessName:hilltop/ planner returned error",
            ),
            { code: 2, codeName: "BadValue" },
          ),
        ),
    });

    const error = await runQuery(
      bucket,
      await prepare({
        where: { code: "grant-a" },
        field: "businessName:Hilltop",
      }),
    ).catch((e) => e);

    expect(error).toMatchObject({
      message: "Bucket read failed",
      code: 2,
      codeName: "BadValue",
    });
    expect(JSON.stringify({ ...error, message: error.message })).not.toMatch(
      /hilltop/i,
    );
    expect(
      JSON.stringify(
        [logger.info, logger.warn, logger.error].map(({ mock }) => mock.calls),
      ),
    ).not.toMatch(/hilltop/i);
  });

  it("refuses to run a field search that was not prepared", async () => {
    await expect(
      runQuery(bucket, parse({ where: { code: "grant-a" }, field: "a:b" })),
    ).rejects.toThrow("A field search must be prepared before it runs");
  });
});

describe("describeBucket with a search", () => {
  it("lists the fields each code declares now", async () => {
    makeCollection([]);

    const entry = await describeBucket(bucket, { withFields: true });

    expect(entry.fields).toEqual({
      fact: "code",
      byValue: {
        "grant-a": [
          { key: "businessName", label: "Business name", match: "prefix" },
          { key: "parcelId", label: "Parcel ID", match: "exact" },
        ],
      },
    });
    expect(catalogueEntrySchema.validate(entry).error).toBeUndefined();
  });
});
