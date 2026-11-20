import {
  BSON,
  BSONRegExp,
  BSONSymbol,
  Binary,
  Code,
  Decimal128,
  Double,
  Int32,
  Long,
  MaxKey,
  MinKey,
  Timestamp,
} from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { elementsOf } from "./bson-bytes.js";
import { checkPart } from "./large-answers.js";
import { compareRows } from "./merge.js";
import { querySchema } from "./query-schema.js";
import { inbox, outbox, testSource } from "./test-source.js";

vi.mock("../logger.js");

// Typed values, sizes, positions, the cells allowance and mongod's failures,
// each against what mongod itself gives for the same records.

const START = Date.UTC(2026, 8, 1);

let replSet;
let mongoClient;
let db;
let run;
let evaluate;

const outboxBucket = outbox();
const inboxBucket = inbox();
const events = testSource([outboxBucket, inboxBucket]);

const query = (overrides = {}) => ({
  v: 4,
  source: "events",
  mode: overrides.groupBy ? "groups" : "rows",
  columns: [{ path: "status" }],
  where: null,
  unwind: [],
  groupBy: null,
  orderBy: null,
  limit: 50,
  positions: null,
  ...overrides,
});

const eq = (path, ...values) => ({ path, op: "eq", values });

const refusal = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return { code: error.refusal, detail: error.detail };
  }

  return null;
};

const nums = {
  name: "nums",
  service: "Test",
  size: "small",
  collection: "nums",
  time: "createdAt",
  answersAt: null,
  open: (doc) => ({ kind: "num", ref: doc.ref }),
  openPaths: ["ref"],
  paths: [{ path: "ref", type: "text" }],
};

const numsQuery = (overrides) => query({ source: "nums", ...overrides });

// Enough rows of two long values to draw past a page's cells allowance.
const WIDE_ROWS = 1100;

const wide = {
  ...nums,
  name: "wide",
  collection: "wide",
  open: (doc) => ({ kind: "wide", ref: doc.ref }),
};

const INT32_MAX = 2 ** 31 - 1;

const NUMS = [
  { ref: "a", g: "ints", x: new Int32(INT32_MAX) },
  { ref: "b", g: "ints", x: new Int32(1) },
  { ref: "c", g: "small", x: new Int32(2) },
  { ref: "d", g: "small", x: new Int32(3) },
  { ref: "e", g: "longs", x: Long.fromString("9223372036854775807") },
  { ref: "f", g: "longs", x: Long.fromNumber(1) },
  { ref: "g", g: "mixed", x: new Int32(1) },
  { ref: "h", g: "mixed", x: new Double(0.5) },
  { ref: "i", g: "decimals", x: Decimal128.fromString("1.10") },
  { ref: "j", g: "decimals", x: Decimal128.fromString("2.205") },
  { ref: "k", g: "decimals", x: new Int32(3) },
  { ref: "l", g: new Int32(5), x: new Int32(1) },
  { ref: "m", g: new Double(5), x: new Int32(1) },
  { ref: "n", g: new Date("2026-10-01T00:00:00.000Z"), x: new Int32(1) },
  { ref: "o", g: "2026-10-01T00:00:00.000Z", x: new Int32(1) },
];

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", "explore-typed-test");
  vi.resetModules();

  ({ mongoClient, db } = await import("../mongo-client.js"));
  run = await import("./run.js");
  evaluate = await import("./evaluate.js");
  const { ensureIndexes } = await import("../buckets/indexes.js");

  await mongoClient.connect();
  await db.collection("nums").insertMany(
    NUMS.map((doc, n) => ({
      ...doc,
      createdAt: new Date(START + n * 1000).toISOString(),
    })),
  );
  await db.collection("outbox").insertMany(
    Array.from({ length: 60 }, (_, n) => ({
      status: n % 2 ? "FAILED" : "COMPLETED",
      eventType: "case.create",
      code: "code-1",
      publicationDate: new Date(START + n * 1000),
      ...(n === 3 ? { items: "not a list" } : { items: [n, { n }] }),
      parcels: [{ id: `P${n}` }, { id: `Q${n}`, areas: [1, 2] }],
      note: "x".repeat(2000),
    })),
  );
  await db.collection("wide").insertMany(
    Array.from({ length: WIDE_ROWS }, (_, n) => ({
      ref: `w${n}`,
      createdAt: new Date(START + n * 1000).toISOString(),
      a: "a".repeat(1000),
      b: "b".repeat(1000),
    })),
  );
  await ensureIndexes(db, outboxBucket);
  await ensureIndexes(db, inboxBucket);
}, 120_000);

afterAll(async () => {
  await mongoClient?.close();
  await replSet?.stop();
});

const BSON_NUMBER = /^(Int32|Long|Double|Decimal128)$/;

const typedOf = (value) =>
  BSON_NUMBER.test(value?._bsontype ?? "")
    ? { type: value._bsontype, value: String(value) }
    : value;

describe("groups typed as mongod's $group types them", () => {
  it("sums, counts and keys with mongod's types, first seen key kept", async () => {
    const part = await run.runPart(
      nums,
      numsQuery({
        mode: "groups",
        columns: [
          { path: "g" },
          { fn: "sum", path: "x", as: "s" },
          { fn: "count", path: "*", as: "n" },
          { fn: "max", path: "x", as: "m" },
        ],
        groupBy: { path: "g" },
        limit: 5000,
      }),
    );
    const sent = JSON.parse(JSON.stringify(part.groups));
    const ours = sent.map((group) => ({
      _id: typedOf(evaluate.orderedValue(group.value)),
      s: typedOf(evaluate.partialValue("sum", group.aggs["sum(x)"])),
      n: typedOf(evaluate.partialValue("count", group.aggs["count(*)"])),
      m: typedOf(evaluate.partialValue("max", group.aggs["max(x)"])),
    }));
    const mongod = (
      await db
        .collection("nums")
        .aggregate(
          [
            {
              $group: {
                _id: "$g",
                s: { $sum: "$x" },
                n: { $sum: 1 },
                m: { $max: "$x" },
                first: { $min: "$createdAt" },
              },
            },
            { $sort: { first: 1 } },
            { $project: { first: 0 } },
          ],
          { promoteValues: false },
        )
        .toArray()
    ).map((group) =>
      Object.fromEntries(
        Object.entries(group).map(([key, value]) => [key, typedOf(value)]),
      ),
    );

    expect(ours).toEqual(mongod);
    expect(ours.map(({ s }) => s.type)).toEqual([
      "Long",
      "Int32",
      "Double",
      "Double",
      "Decimal128",
      "Int32",
      "Int32",
      "Int32",
    ]);
  });

  it("keys a Date and its ISO text as two groups, and Int32 and Double 5 as one", async () => {
    const part = await run.runPart(
      nums,
      numsQuery({
        mode: "groups",
        columns: [{ path: "g" }, { fn: "count", path: "*", as: "n" }],
        groupBy: { path: "g" },
        where: { path: "ref", op: "in", values: ["l", "m", "n", "o"] },
        limit: 5000,
      }),
    );

    expect(part.groups.map(({ value, n }) => [value, n])).toEqual([
      [{ i: 5 }, 2],
      [{ d: "2026-10-01T00:00:00.000Z" }, 1],
      ["2026-10-01T00:00:00.000Z", 1],
    ]);
  });

  it("keys other BSON types by type and value, apart from text that reads alike, a Symbol as its text, and sends them as stored", async () => {
    const values = [
      new Binary(Buffer.from("abc"), 4),
      "abc",
      new Timestamp({ t: 1, i: 2 }),
      "4294967298",
      new Code("a"),
      new Code("b"),
      new MinKey(),
      new MaxKey(),
      new BSONRegExp("a", "i"),
      new BSONRegExp("b", ""),
      new BSONRegExp("a", "x"),
      new BSONRegExp("a", ""),
      new BSONSymbol("sym"),
      "sym",
    ];
    const refs = values.map((_, n) => `other-${n}`);

    await db.collection("nums").insertMany(
      values.map((g, n) => ({
        ref: refs[n],
        g,
        x: new Int32(1),
        createdAt: new Date(START + 90_000 + n).toISOString(),
      })),
    );

    const part = await run.runPart(
      nums,
      numsQuery({
        mode: "groups",
        columns: [{ path: "g" }, { fn: "count", path: "*", as: "n" }],
        groupBy: { path: "g" },
        where: { path: "ref", op: "in", values: refs },
        limit: 5000,
      }),
    );
    const sent = JSON.parse(JSON.stringify(part.groups));
    const ours = sent.map(({ value, n }) => [
      BSON.serialize({ _id: evaluate.bsonValueOf(value) }).toString("hex"),
      n,
    ]);
    const mongod = await db
      .collection("nums")
      .aggregate(
        [
          { $match: { ref: { $in: refs } } },
          { $group: { _id: "$g", n: { $sum: 1 } } },
        ],
        { raw: true },
      )
      .toArray();
    // mongod's own { _id } bytes: the reply's first element, alone.
    const idOnly = (buf) => {
      const [{ end }] = elementsOf(buf);
      const id = Buffer.alloc(end + 1);

      buf.copy(id, 4, 4, end);
      id.writeInt32LE(id.length, 0);

      return id.toString("hex");
    };
    const sorted = (pairs) => [...pairs].sort(([a], [b]) => a.localeCompare(b));

    expect(sorted(ours)).toEqual(
      sorted(
        mongod.map((buf) => [
          idOnly(Buffer.from(buf)),
          BSON.deserialize(buf).n,
        ]),
      ),
    );
    expect(ours).toHaveLength(values.length - 1);
    await db.collection("nums").deleteMany({ ref: { $in: refs } });
  });

  it("sends a group's whole value, a list longer than 100 values too", async () => {
    await db.collection("nums").insertOne({
      ref: "long",
      g: Array.from({ length: 150 }, (_, n) => ({ n })),
      createdAt: new Date(START + 99_000).toISOString(),
    });

    const part = await run.runPart(
      nums,
      numsQuery({
        mode: "groups",
        columns: [{ path: "g" }, { fn: "count", path: "*", as: "n" }],
        groupBy: { path: "g" },
        where: eq("ref", "long"),
        limit: 5000,
      }),
    );

    expect(evaluate.orderedValue(part.groups[0].value)).toHaveLength(150);
    await db.collection("nums").deleteOne({ ref: "long" });
  });
});

describe("Doubles beside Decimal128s, as mongod's", () => {
  const MIXED = [
    { ref: "a", g: "tenth", x: new Double(0.1) },
    { ref: "b", g: "tenth", x: Decimal128.fromString("0.1") },
    { ref: "c", g: "three", x: new Double(0.3) },
    { ref: "d", g: "three", x: Decimal128.fromString("0.3") },
    { ref: "e", g: "half", x: new Double(0.5) },
    { ref: "f", g: "half", x: Decimal128.fromString("0.5") },
    { ref: "g", g: "one", x: new Double(1) },
    { ref: "h", g: "one", x: new Int32(1) },
    { ref: "i", g: "one", x: Decimal128.fromString("1.0") },
    { ref: "j", g: "one", x: Long.fromNumber(1) },
    { ref: "k", g: "nan", x: new Double(Number.NaN) },
    { ref: "l", g: "nan", x: Decimal128.fromString("NaN") },
    { ref: "m", g: "huge", x: Long.fromString("9223372036854775807") },
    { ref: "n", g: "past", x: Long.fromString("9007199254740993") },
    { ref: "o", g: "past", x: Long.fromString("9007199254740992") },
    { ref: "p", g: "past", x: Long.fromString("-9007199254740993") },
  ];
  const mixed = {
    ...nums,
    name: "mixed",
    collection: "mixed",
    open: (doc) => ({ kind: "mixed", ref: doc.ref }),
  };
  const mixedQuery = (overrides) => query({ source: "mixed", ...overrides });
  const refsOf = (part) => part.boxes[0].rows.map(({ cells }) => cells.c0);

  beforeAll(async () => {
    await db.collection("mixed").insertMany(
      MIXED.map((doc, n) => ({
        ...doc,
        createdAt: new Date(START + n * 1000).toISOString(),
      })),
    );
  });

  it("groups them by exact value", async () => {
    const part = await run.runPart(
      mixed,
      mixedQuery({
        mode: "groups",
        columns: [{ path: "x" }, { fn: "count", path: "*", as: "n" }],
        groupBy: { path: "x" },
        limit: 5000,
      }),
    );
    const sent = JSON.parse(JSON.stringify(part.groups));
    const mongod = await db
      .collection("mixed")
      .aggregate(
        [
          {
            $group: {
              _id: "$x",
              n: { $sum: 1 },
              first: { $min: "$createdAt" },
            },
          },
          { $sort: { first: 1 } },
        ],
        { promoteValues: false },
      )
      .toArray();

    expect(
      sent.map(({ value, n }) => [typedOf(evaluate.orderedValue(value)), n]),
    ).toEqual(mongod.map(({ _id, n }) => [typedOf(_id), Number(n)]));
  });

  it.each(
    ["eq", "ne", "lt", "lte", "gt", "gte"].flatMap((op) =>
      [0.1, 0.3, 0.5, 1, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER].map(
        (wanted) => [op, wanted],
      ),
    ),
  )("finds those %s %s", async (op, wanted) => {
    const { value: asked, error } = querySchema.validate(
      mixedQuery({
        columns: [{ path: "ref" }],
        where: { path: "x", op, values: [wanted] },
      }),
    );
    const part = await run.runPart(mixed, asked);
    const mongod = await db
      .collection("mixed")
      .find({ x: { [`$${op}`]: wanted } })
      .toArray();

    expect(error).toBeUndefined();
    expect(refsOf(part).sort()).toEqual(mongod.map(({ ref }) => ref).sort());
  });

  it.each([[false], [true]])("sorts them, descending %s", async (desc) => {
    const part = await run.runPart(
      mixed,
      mixedQuery({
        columns: [{ path: "ref" }],
        orderBy: { path: "x", fn: null, desc },
      }),
    );
    const way = desc ? -1 : 1;
    const mongod = await db
      .collection("mixed")
      .find()
      .sort({ x: way, _id: way })
      .toArray();

    expect(refsOf(part)).toEqual(mongod.map(({ ref }) => ref));
  });

  it("takes the least and greatest of each as $min and $max do", async () => {
    const part = await run.runPart(
      mixed,
      mixedQuery({
        mode: "groups",
        columns: [
          { path: "g" },
          { fn: "min", path: "x", as: "lo" },
          { fn: "max", path: "x", as: "hi" },
        ],
        groupBy: { path: "g" },
        where: { path: "g", op: "in", values: ["tenth", "three"] },
        limit: 5000,
      }),
    );
    const sent = JSON.parse(JSON.stringify(part.groups));
    const mongod = await db
      .collection("mixed")
      .aggregate(
        [
          { $match: { g: { $in: ["tenth", "three"] } } },
          { $group: { _id: "$g", lo: { $min: "$x" }, hi: { $max: "$x" } } },
        ],
        { promoteValues: false },
      )
      .toArray();
    const byGroup = (pairs) =>
      Object.fromEntries(pairs.sort(([a], [b]) => a.localeCompare(b)));

    expect(
      byGroup(
        sent.map(({ value, aggs }) => [
          value,
          [
            typedOf(evaluate.partialValue("min", aggs["min(x)"])),
            typedOf(evaluate.partialValue("max", aggs["max(x)"])),
          ],
        ]),
      ),
    ).toEqual(
      byGroup(
        mongod.map(({ _id, lo, hi }) => [_id, [typedOf(lo), typedOf(hi)]]),
      ),
    );
  });
});

describe("rows with what their documents are fetched by", () => {
  it("carry each record's typed _id and its stored size, as $bsonSize gives it", async () => {
    const part = await run.runPart(
      events,
      query({
        where: eq("code", "code-1"),
        documents: { whole: true, id: true },
        limit: 5,
      }),
    );
    const [row] = part.boxes[0].rows;
    const [stored] = await db
      .collection("outbox")
      .aggregate([
        {
          $match: { _id: BSON.deserialize(Buffer.from(row.id, "base64"))._id },
        },
        { $project: { size: { $bsonSize: "$$ROOT" } } },
      ])
      .toArray();

    expect(row.size).toBe(stored.size);
    expect(row.at).toEqual([]);
  });

  it("carry none of it when no document is asked for", async () => {
    const part = await run.runPart(
      events,
      query({ where: eq("code", "code-1"), limit: 1 }),
    );
    const [row] = part.boxes[0].rows;

    expect(row).not.toHaveProperty("id");
    expect(row).not.toHaveProperty("at");
    expect(row).not.toHaveProperty("size");
  });

  it("carry the positions mongod's includeArrayIndex gives an unwound row", async () => {
    const part = await run.runPart(
      events,
      query({
        where: eq("code", "code-1"),
        unwind: [
          { path: "parcels", preserve: false },
          { path: "parcels.areas", preserve: true },
        ],
        columns: [{ path: "parcels.id" }],
        orderBy: { path: "parcels.id", fn: null, desc: false },
        documents: { whole: true, id: true },
        limit: 5000,
      }),
    );
    const mongod = await db
      .collection("outbox")
      .aggregate([
        { $match: { code: "code-1" } },
        { $unwind: { path: "$parcels", includeArrayIndex: "i0" } },
        {
          $unwind: {
            path: "$parcels.areas",
            includeArrayIndex: "i1",
            preserveNullAndEmptyArrays: true,
          },
        },
        { $project: { id: "$parcels.id", at: ["$i0", "$i1"] } },
        { $sort: { id: 1, at: 1 } },
      ])
      .toArray();
    const ours = part.boxes
      .flatMap(({ rows }) => rows)
      .map(({ cells, at }) => [cells.c0, at])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

    expect(ours).toEqual(
      mongod
        .map(({ id, at }) => [
          id,
          at.map((n) => (n === null ? null : Number(n))),
        ])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
  });
});

describe("the cells allowance", () => {
  it("ends a windowed read early within it, at least one row, and goes on from there", async () => {
    const asked = query({
      columns: [{ path: "note" }],
      where: { path: "note", op: "filled", values: [] },
      cellBytes: 5000,
      window: true,
      limit: 50,
    });
    const part = await run.runPart(events, asked);
    const box = part.boxes.find(({ id }) => id === "test.outbox");

    expect(box.rows).toHaveLength(2);
    expect(box).toMatchObject({ end: false, partial: true, cut: true });
    expect(box.to.i).toBe(box.rows.at(-1).key.i);
  });

  it("counts a page's long values as drawn, each up to 1,000 characters", async () => {
    const part = await run.runPart(
      events,
      query({
        columns: [{ path: "note" }],
        where: eq("code", "code-1"),
        limit: 60,
      }),
    );

    expect(part.boxes.flatMap(({ rows }) => rows)).toHaveLength(60);
    expect(part.boxes[0].rows[0].cells.c0).toHaveLength(2000);
  });

  it("reads at least one row however large", async () => {
    const part = await run.runPart(
      events,
      query({
        columns: [{ path: "note" }],
        where: { path: "note", op: "filled", values: [] },
        cellBytes: 10,
        window: true,
      }),
    );

    expect(part.boxes.find(({ id }) => id === "test.outbox").rows).toHaveLength(
      1,
    );
  });

  it("ends a download's exact read at its last whole row in the Query's order, saying where it stands", async () => {
    const part = await run.runPart(
      events,
      query({
        columns: [{ path: "note" }],
        where: eq("code", "code-1"),
        orderBy: { path: "publicationDate", fn: null, desc: false },
        cellBytes: 5000,
      }),
    );
    const rows = part.boxes.flatMap(({ rows: kept }) => kept);
    const oldest = (n) => new Date(START + n * 1000).toISOString();

    expect(part.read).toBe("exact");
    expect(rows.map(({ key }) => key.t)).toEqual([oldest(0), oldest(1)]);
    expect(part.cutAfter).toEqual({
      key: { ...rows[1].key, box: "test.outbox" },
      order: rows[1].order,
    });
    expect((await checkPart(part)).cutAfter).toEqual(part.cutAfter);
  });

  it("says nothing of a cut when a download's rows all fit", async () => {
    const part = await run.runPart(
      events,
      query({
        columns: [{ path: "note" }],
        where: eq("code", "code-1"),
        cellBytes: 256 * 1024 * 1024,
      }),
    );

    expect(part.boxes.flatMap(({ rows }) => rows)).toHaveLength(50);
    expect(part).not.toHaveProperty("cutAfter");
  });

  it("refuses a page's exact read whose cells don't fit, and cuts a download's full read", async () => {
    const asked = query({
      source: "wide",
      columns: [{ path: "a" }, { path: "b" }],
      limit: WIDE_ROWS,
    });

    expect(await refusal(run.runPart(wide, asked))).toMatchObject({
      code: "CELLS_TOO_LARGE",
    });

    const part = await run.runPart(wide, { ...asked, cellBytes: 5000 });

    expect(part.read).toBe("full");
    expect(part.boxes[0].rows).toHaveLength(2);
    expect(part.cutAfter.key.i).toBe(part.boxes[0].rows[1].key.i);
  });

  describe("over both boxes", () => {
    const BOTH = "both-boxes";
    const at = (n) => new Date(START + (1000 + n) * 1000);
    const event = {
      status: "COMPLETED",
      eventType: "case.create",
      code: BOTH,
      note: "x".repeat(2000),
    };

    beforeAll(async () => {
      await db
        .collection("outbox")
        .insertMany(
          [0, 2, 4].map((n) => ({ ...event, publicationDate: at(n) })),
        );
      await db.collection("inbox").insertMany(
        [1, 3, 5].map((n) => ({
          ...event,
          publicationDate: at(n).toISOString(),
        })),
      );
    });

    afterAll(async () => {
      await db.collection("outbox").deleteMany({ code: BOTH });
      await db.collection("inbox").deleteMany({ code: BOTH });
    });

    const download = (orderBy, cellBytes) =>
      run.runPart(
        events,
        query({
          columns: [{ path: "note" }],
          where: eq("code", BOTH),
          orderBy,
          cellBytes,
        }),
      );

    const placesOf = (part) =>
      part.boxes.flatMap(({ id, rows }) =>
        rows.map((row) => ({ key: { ...row.key, box: id }, order: row.order })),
      );

    it.each([
      ["ascending", { path: "publicationDate", fn: null, desc: false }],
      ["descending", { path: "publicationDate", fn: null, desc: true }],
    ])(
      "cuts a download's exact read where the merge's order does, %s",
      async (_, orderBy) => {
        const order = compareRows(orderBy);
        const all = placesOf(await download(orderBy, 256 * 1024 * 1024)).sort(
          order,
        );
        const part = await download(orderBy, 5000);
        const kept = placesOf(part).sort(order);

        expect(part.read).toBe("exact");
        expect(all).toHaveLength(6);
        expect(new Set(kept.map(({ key }) => key.box)).size).toBe(2);
        expect(kept).toEqual(all.slice(0, 2));
        expect(part.cutAfter).toEqual(all[1]);
        expect((await checkPart(part)).cutAfter).toEqual(part.cutAfter);
      },
    );
  });
});

describe("$size, as mongod's", () => {
  const sized = (overrides) =>
    query({
      columns: [{ fn: "count", path: "items", as: "n" }],
      where: eq("code", "code-1"),
      ...overrides,
    });

  it.each([
    ["exact", {}],
    ["windowed", { window: true }],
  ])(
    "fails an %s read with mongod's words when a shown row's value isn't a list",
    async (_, overrides) => {
      const ours = await refusal(
        run.runPart(events, sized({ limit: 60, ...overrides })),
      );
      const mongod = await db
        .collection("outbox")
        .find({ code: "code-1" }, { projection: { n: { $size: "$items" } } })
        .toArray()
        .catch((error) => error.errmsg);

      expect(ours).toEqual({
        code: "MONGOD_ERROR",
        detail: { fn: "count", type: "string", column: 0 },
      });
      expect(mongod).toContain(
        `The argument to $size must be an array, but was of type: ${ours.detail.type}`,
      );
    },
  );

  it("answers when no shown row fails, as mongod's find with a limit does", async () => {
    const part = await run.runPart(events, sized({ limit: 5 }));
    const mongod = await db
      .collection("outbox")
      .find({ code: "code-1" }, { projection: { n: { $size: "$items" } } })
      .sort({ publicationDate: -1, _id: -1 })
      .limit(5)
      .toArray();

    expect(part.boxes[0].rows.map(({ cells }) => cells.c0)).toEqual(
      mongod.map(({ n }) => n),
    );
  });

  it("sorts by lists longer than 100 values as mongod's sort does", async () => {
    await db.collection("nums").insertMany([
      {
        ref: "p",
        obj: { l: [...Array(120).fill(1), 3] },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        ref: "q",
        obj: { l: [...Array(120).fill(1), 2] },
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ]);

    const part = await run.runPart(
      nums,
      numsQuery({
        columns: [{ path: "ref" }],
        where: { path: "ref", op: "in", values: ["p", "q"] },
        orderBy: { path: "obj", fn: null, desc: true },
      }),
    );
    const mongod = await db
      .collection("nums")
      .find({ ref: { $in: ["p", "q"] } })
      .sort({ obj: -1 })
      .toArray();

    expect(part.boxes[0].rows.map(({ cells }) => cells.c0)).toEqual(
      mongod.map(({ ref }) => ref),
    );
  });
});
