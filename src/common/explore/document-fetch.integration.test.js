import {
  BSON,
  BSONRegExp,
  Binary,
  Collection,
  Decimal128,
  Double,
  Int32,
  Long,
  MaxKey,
  MinKey,
  MongoServerError,
  ObjectId,
  Timestamp,
} from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { connect } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  expectReadsOnly,
  spyCollections,
} from "../../../test/helpers/explore-read-only.js";
import { ledBucket } from "../buckets/test-bucket.js";
import { outbox } from "./test-source.js";

vi.mock("../logger.js");

// Run against another mongod with EXPLORE_MONGOD_URI (a scratch database
// only: it is dropped after).
const OTHER_MONGOD = process.env.EXPLORE_MONGOD_URI;
const DATABASE = "explore_fetch_scratch";
const MIB = 1024 * 1024;
const SENTINEL = "sentinel-c41d7e";

let replSet;
let uri;
let mongoClient;
let db;
let fetchDocuments;
let fetchPart;
let meterFor;
let startOf;
let valuesOf;
let START_BYTES;
let START_RESERVE_MS;
let bsonTypeName;
let logger;

// ── BSON written by hand ──

const int32 = (n) => {
  const buf = Buffer.alloc(4);

  buf.writeInt32LE(n);

  return buf;
};

const int64 = (n) => {
  const buf = Buffer.alloc(8);

  buf.writeBigInt64LE(BigInt(n));

  return buf;
};

const cstring = (text) => Buffer.concat([Buffer.from(text), Buffer.from([0])]);

const string = (bytes) => {
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  return Buffer.concat([int32(value.length + 1), value, Buffer.from([0])]);
};

const documentOf = (elements) => {
  const body = Buffer.concat([
    ...elements.map(([type, name, value]) =>
      Buffer.concat([Buffer.from([type]), cstring(name), value]),
    ),
    Buffer.from([0]),
  ]);

  return Buffer.concat([int32(body.length + 4), body]);
};

const idElement = (id) => [0x07, "_id", Buffer.from(id.id)];

// Documents inserted as their own bytes, in one OP_MSG insert, so mongod
// stores what `bson` could never write.
const rawInsert = (collection, docs) =>
  new Promise((resolve, reject) => {
    const { hostname, port } = new URL(uri.replace("mongodb://", "http://"));
    const command = BSON.serialize({
      insert: collection,
      $db: DATABASE,
      ordered: false,
    });
    const name = cstring("documents");
    const sequence = Buffer.concat(docs);
    const message = Buffer.concat([
      int32(0),
      Buffer.from([0]),
      command,
      Buffer.from([1]),
      int32(4 + name.length + sequence.length),
      name,
      sequence,
    ]);
    const header = Buffer.concat([
      int32(16 + message.length),
      int32(1),
      int32(0),
      int32(2013),
    ]);
    const socket = connect(Number(port), hostname);
    const chunks = [];

    socket.on("error", reject);
    socket.on("data", (chunk) => {
      chunks.push(chunk);

      const reply = Buffer.concat(chunks);

      if (reply.length >= 4 && reply.length >= reply.readInt32LE(0)) {
        socket.end();
        resolve(BSON.deserialize(reply.subarray(21)));
      }
    });
    socket.write(Buffer.concat([header, message]));
  });

// ── Reading ──

const sourceOf = (collection, extra = {}) => ({
  name: collection,
  label: collection,
  service: "GAS",
  size: "small",
  collection,
  time: "createdAt",
  noun: { one: "record", many: "records" },
  star: [],
  open: () => null,
  openPaths: [],
  paths: [],
  ...extra,
});

const NO_QUERY = {
  columns: [{ path: "_id" }],
  unwind: [],
  where: null,
  whole: false,
  id: true,
};

const queryOf = (asked = {}) => {
  const { columns, unwind, where, whole, id } = { ...NO_QUERY, ...asked };

  return { columns, unwind, where, documents: { whole, id } };
};

const idText = (_id) => BSON.serialize({ _id }).toString("base64");

const meter = () => meterFor(Date.now() + 20_000);

const fetchRows = (source, query, rows, bytes = 16 * MIB) =>
  fetchDocuments(source, query, { rows, meter: meter(), bytes });

const boxOf = (source) => `gas.${source.name}`;

const fetchOne = async (source, query, _id, at = []) =>
  (
    await fetchRows(source, query, [
      { box: boxOf(source), id: idText(_id), at },
    ])
  )[0];

const docOf = (entry) => Buffer.from(entry.doc, "base64");

const rawOf = async (collection, _id, projection) => {
  const [buf] = await db
    .collection(collection)
    .find({ _id }, { raw: true, projection })
    .toArray();

  return Buffer.from(buf);
};

const refusalOf = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return { refusal: error.refusal, detail: error.detail };
  }

  return null;
};

beforeAll(async () => {
  if (OTHER_MONGOD) {
    uri = OTHER_MONGOD;
  } else {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = replSet.getUri();
  }

  vi.stubEnv("MONGO_URI", uri);
  vi.stubEnv("MONGO_DATABASE", DATABASE);
  vi.resetModules();

  ({ mongoClient, db } = await import("../mongo-client.js"));
  ({ fetchDocuments, fetchPart, START_RESERVE_MS } =
    await import("./document-fetch.js"));
  ({ startOf, START_BYTES } = await import("./document-start.js"));
  ({ valuesOf } = await import("./bson-bytes.js"));
  ({ meterFor } = await import("./meter.js"));
  ({ bsonTypeName } = await import("./evaluate.js"));
  ({ logger } = await import("../logger.js"));

  await mongoClient.connect();
  await db.dropDatabase();
}, 120_000);

// Every test's log lines, kept before the mocks are reset for the next.
const logged = [];

afterEach(() => {
  Object.values(logger)
    .filter((log) => vi.isMockFunction(log))
    .forEach((log) => logged.push(...log.mock.calls));
});

afterAll(async () => {
  await db?.dropDatabase();
  await mongoClient?.close();
  await replSet?.stop();
});

// ── Fixtures ──

const deep = (depth, leaf) =>
  Array.from({ length: depth }).reduce((inner) => [inner], leaf);

const everyType = (_id) =>
  new Map([
    ["_id", _id],
    ["int32", new Int32(5)],
    ["int64", Long.fromString("9007199254740993")],
    ["double", new Double(5)],
    ["minusZero", new Double(-0)],
    ["nan", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["minusInfinity", Number.NEGATIVE_INFINITY],
    ["decimal", Decimal128.fromString("1234567890.123456789012345678901234")],
    ["before1970", new Date(-86_400_000 * 365 * 100)],
    ["after9999", new Date(Date.UTC(10_000, 0, 1))],
    ["objectId", new ObjectId()],
    ["binary0", new Binary(Buffer.from("bytes"), 0)],
    ["uuid", new Binary(Buffer.alloc(16, 7), 4)],
    ["binary128", new Binary(Buffer.from("own"), 128)],
    ["timestamp", new Timestamp({ t: 1_700_000_000, i: 3 })],
    ["regex", new BSONRegExp("^a.b$", "imsx")],
    ["min", new MinKey()],
    ["max", new MaxKey()],
    ["null", null],
    ["deep", deep(20, "bottom")],
    [
      "keys",
      new Map([
        ["$schema", "http://json-schema.org/draft-07/schema#"],
        [
          "link",
          new Map([
            ["$ref", "other"],
            ["$id", new ObjectId()],
          ]),
        ],
        ["at", new Map([["$date", "not a date"]])],
        ["__proto__", "kept"],
        ["constructor", "kept"],
        ["a.b", "dotted"],
        ["", "empty"],
        ["ünïcødé ✓ 🌱", "text ✓ 🌱"],
      ]),
    ],
    ["parcels", Array.from({ length: 3552 }, (_, n) => ({ n, id: `P${n}` }))],
    ["note", SENTINEL],
  ]);

const ODD = [
  ["BSON undefined", [[0x06, "u", Buffer.alloc(0)]]],
  [
    "dates outside a JavaScript Date",
    [
      [0x09, "late", int64(8_640_000_000_000_001n)],
      [0x09, "early", int64(-8_640_000_000_000_001n)],
    ],
  ],
  [
    "a DBRef's keys after others, $db last",
    [
      [
        0x03,
        "ref",
        documentOf([
          [0x02, "x", string("first")],
          [0x07, "$id", Buffer.from(new ObjectId().id)],
          [0x02, "$ref", string("things")],
          [0x02, "$db", string("other")],
        ]),
      ],
    ],
  ],
  [
    "a DBPointer",
    [
      [
        0x0c,
        "pointer",
        Buffer.concat([string("things"), Buffer.from(new ObjectId().id)]),
      ],
    ],
  ],
  [
    "duplicate keys",
    [
      [0x02, "dup", string("one")],
      [0x02, "dup", string("two")],
    ],
  ],
  [
    "a list with keys not 0..n",
    [
      [
        0x04,
        "list",
        documentOf([
          [0x02, "5", string("five")],
          [0x02, "2", string("two")],
        ]),
      ],
    ],
  ],
  [
    "regex flags mi",
    [[0x0b, "re", Buffer.concat([cstring("a+"), cstring("mi")])]],
  ],
  [
    "text that isn't valid UTF-8",
    [[0x02, "bad", string(Buffer.from([0x61, 0xff, 0xfe, 0x62]))]],
  ],
  [
    "a stored $explore",
    [
      [
        0x03,
        "x",
        documentOf([
          [0x03, "$explore", documentOf([[0x08, "gone", Buffer.from([1])]])],
        ]),
      ],
    ],
  ],
  [
    "keys named document and context",
    [
      [0x02, "document", string("d")],
      [0x0a, "context", Buffer.alloc(0)],
    ],
  ],
];

describe("fetchDocuments on mongod", () => {
  describe("a whole record, as stored", () => {
    const things = sourceOf("stored");
    const ids = { every: new ObjectId(), big: new ObjectId() };
    const every = Buffer.from(BSON.serialize(everyType(ids.every)));

    beforeAll(async () => {
      await rawInsert("stored", [
        every,
        Buffer.from(
          BSON.serialize({
            _id: ids.big,
            parcels: Array.from({ length: 15 }, () => "x".repeat(MIB - 64)),
          }),
        ),
      ]);
    }, 60_000);

    it("sends mongod's own bytes of every BSON type and key", async () => {
      const entry = await fetchOne(things, queryOf({ whole: true }), ids.every);

      expect(docOf(entry).equals(await rawOf("stored", ids.every))).toBe(true);
      expect(docOf(entry).equals(every)).toBe(true);
    });

    it("sends a 15 MiB record whole", async () => {
      const entry = await fetchOne(things, queryOf({ whole: true }), ids.big);

      expect(docOf(entry).length).toBeGreaterThan(15 * MIB - 4096);
      expect(docOf(entry).equals(await rawOf("stored", ids.big))).toBe(true);
    });

    it("leaves out only _id for _id: 0, as mongod does", async () => {
      const entry = await fetchOne(
        things,
        queryOf({ whole: true, id: false }),
        ids.every,
      );

      expect(
        docOf(entry).equals(await rawOf("stored", ids.every, { _id: 0 })),
      ).toBe(true);
    });
  });

  describe("records bson would change", () => {
    const odd = sourceOf("odd");
    const stored = ODD.map(([name, elements]) => {
      const _id = new ObjectId();

      return { name, _id, bytes: documentOf([idElement(_id), ...elements]) };
    });
    let inserted;

    beforeAll(async () => {
      inserted = await Promise.all(
        stored.map(({ bytes }) => rawInsert("odd", [bytes])),
      );
    });

    it.each(stored.map((record, n) => [record.name, n]))(
      "sends %s byte for byte",
      async (_, n) => {
        const { _id, bytes } = stored[n];

        expect(inserted[n]).toMatchObject({ ok: 1, n: 1 });

        const entry = await fetchOne(odd, queryOf({ whole: true }), _id);

        expect(docOf(entry).equals(bytes)).toBe(true);
        expect(docOf(entry).equals(await rawOf("odd", _id))).toBe(true);
      },
    );
  });

  describe("projections, against mongod's own", () => {
    const shaped = sourceOf("shaped");
    // mongosh's projection, and the Query's columns for it: mongod's own
    // output for each, measured on mongod 7.
    const CASES = [
      [
        "stored key order",
        { _id: 1, b: 1, a: { y: 1, x: 2 }, c: 3 },
        { c: 1, "a.x": 1, b: 1 },
        [{ path: "c" }, { path: "a.x" }, { path: "b" }],
      ],
      [
        "_id listed",
        { _id: 1, b: 1, a: { y: 1, x: 2 }, c: 3 },
        { c: 1, b: 1, _id: 1 },
        [{ path: "_id" }, { path: "c" }, { path: "b" }],
      ],
      [
        "_id stored second",
        { b: 1, _id: 1, a: { y: 1, x: 2 }, c: 3 },
        { c: 1, b: 1 },
        [{ path: "c" }, { path: "b" }],
      ],
      [
        "computed after included",
        { _id: 1, c: 3, arr: [1, 2, 3], a: 1, z: 9 },
        { a: 1, n: { $size: "$arr" }, r: "$c" },
        [
          { path: "a" },
          { fn: "count", path: "arr", as: "n" },
          { path: "c", as: "r" },
        ],
      ],
      [
        "computed first in the projection",
        { _id: 1, c: 3, arr: [1, 2, 3], a: 1, z: 9 },
        { n: { $size: "$arr" }, z: 1, a: 1 },
        [{ fn: "count", path: "arr", as: "n" }, { path: "z" }, { path: "a" }],
      ],
      [
        "computed named like a stored key",
        { _id: 1, c: 3, arr: [1, 2, 3], a: 1, z: 9 },
        { z: 1, c: "$z", a: 1 },
        [{ path: "z" }, { path: "z", as: "c" }, { path: "a" }],
      ],
      [
        "{} kept for an object without the path",
        { _id: 1, a: { x: 1 } },
        { "a.b.c": 1 },
        [{ path: "a.b.c" }],
      ],
      [
        "a scalar parent left out",
        { _id: 1, a: 7 },
        { "a.b.c": 1 },
        [{ path: "a.b.c" }],
      ],
      [
        "a missing parent left out",
        { _id: 1 },
        { "a.b.c": 1 },
        [{ path: "a.b.c" }],
      ],
      [
        "an empty object inside",
        { _id: 1, a: { b: {} } },
        { "a.b.c": 1 },
        [{ path: "a.b.c" }],
      ],
      [
        "a scalar inside",
        { _id: 1, a: { b: 7 } },
        { "a.b.c": 1 },
        [{ path: "a.b.c" }],
      ],
      [
        "a null parent",
        { _id: 1, a: null },
        { "a.b.c": 1 },
        [{ path: "a.b.c" }],
      ],
      [
        "through a list",
        { _id: 1, a: [{ b: 1 }, { c: 2 }, 5, [{ b: 4 }], null] },
        { "a.b": 1 },
        [{ path: "a.b" }],
      ],
      ["an empty list", { _id: 1, a: [] }, { "a.b": 1 }, [{ path: "a.b" }]],
      [
        "through two lists",
        { _id: 1, a: [{ b: [{ c: 1, d: 2 }, 3] }] },
        { "a.b.c": 1 },
        [{ path: "a.b.c" }],
      ],
      [
        "two paths in each element",
        { _id: 1, a: [{ b: 1, c: 2, d: 3 }, { d: 4 }] },
        { "a.b": 1, "a.c": 1 },
        [{ path: "a.b" }, { path: "a.c" }],
      ],
      [
        "two paths, stored order",
        { _id: 1, a: [{ c: 2, b: 1, d: 3 }, { d: 4 }] },
        { "a.b": 1, "a.c": 1 },
        [{ path: "a.b" }, { path: "a.c" }],
      ],
      [
        "a position on a list is a key",
        { _id: 1, a: [{ x: 1 }, { x: 2 }] },
        { "a.0": 1 },
        [{ path: "a.0" }],
      ],
      [
        "a position on an object is its key",
        { _id: 1, a: { 0: 5, x: 1 } },
        { "a.0": 1 },
        [{ path: "a.0" }],
      ],
      [
        "a position then a key",
        { _id: 1, a: [{ x: 1 }, { x: 2 }] },
        { "a.0.x": 1 },
        [{ path: "a.0.x" }],
      ],
      [
        "_id: 0 and a path",
        { _id: 1, a: 1, b: 2 },
        { _id: 0, a: 1 },
        [{ path: "a" }],
        false,
      ],
      ["_id alone", { _id: 1, a: 1, b: 2 }, { _id: 1 }, [{ path: "_id" }]],
      [
        "$sum, $min and $max of a list",
        { _id: 1, a: [{ v: new Int32(2) }, { v: 2.5 }, { v: "x" }] },
        { s: { $sum: "$a.v" }, lo: { $min: "$a.v" }, hi: { $max: "$a.v" } },
        [
          { fn: "sum", path: "a.v", as: "s" },
          { fn: "min", path: "a.v", as: "lo" },
          { fn: "max", path: "a.v", as: "hi" },
        ],
      ],
      [
        "$sum of Int32s, and of a scalar",
        { _id: 1, a: [new Int32(1), new Int32(2)], b: new Int32(7) },
        { s: { $sum: "$a" }, t: { $sum: "$b" } },
        [
          { fn: "sum", path: "a", as: "s" },
          { fn: "sum", path: "b", as: "t" },
        ],
      ],
      [
        "a dotted name",
        { _id: 1, code: "x", n: { m: 1 } },
        { "names.code": "$code", n: 1 },
        [{ path: "code", as: "names.code" }, { path: "n" }],
      ],
      [
        "a renamed path through a list",
        { _id: 1, a: [{ b: 1 }, { b: [2, 3] }, {}] },
        { r: "$a.b" },
        [{ path: "a.b", as: "r" }],
      ],
    ];

    beforeAll(async () => {
      await rawInsert(
        "shaped",
        CASES.map(([, doc], n) =>
          Buffer.from(
            BSON.serialize(
              new Map(
                Object.entries(doc).map(([key, value]) =>
                  key === "_id" ? [key, n] : [key, value],
                ),
              ),
            ),
          ),
        ),
      );
    });

    it.each(CASES.map(([name], n) => [name, n]))("%s", async (_, n) => {
      const [, , projection, columns, id = true] = CASES[n];
      const entry = await fetchOne(shaped, queryOf({ columns, id }), n);

      expect(BSON.deserialize(docOf(entry))).toEqual(
        BSON.deserialize(await rawOf("shaped", n, projection)),
      );
      expect(docOf(entry).equals(await rawOf("shaped", n, projection))).toBe(
        true,
      );
    });
  });

  describe("$size of anything but a list", () => {
    const sized = sourceOf("sized");
    const VALUES = [
      ["missing", undefined],
      ["int", new Int32(3)],
      ["long", Long.fromNumber(3)],
      ["double", new Double(3)],
      ["string", "x"],
      ["null", null],
      ["object", { a: 1 }],
      ["bool", true],
      ["date", new Date(0)],
      ["objectId", new ObjectId()],
    ];
    const query = queryOf({
      columns: [{ path: "code" }, { fn: "count", path: "p", as: "n" }],
    });

    beforeAll(async () => {
      await db
        .collection("sized")
        .insertMany(
          VALUES.map(([, value], n) =>
            value === undefined ? { _id: n } : { _id: n, p: value },
          ),
        );
    });

    it.each(VALUES.map(([type], n) => [type, n]))(
      "fails as mongod does, naming the type as mongod and the evaluator do: %s",
      async (type, n) => {
        const mongod = await db
          .collection("sized")
          .find({ _id: n }, { projection: { n: { $size: "$p" } } })
          .toArray()
          .catch((error) => error);
        const [stored] = await db
          .collection("sized")
          .find({ _id: n }, { promoteValues: false })
          .toArray();

        expect(mongod.code).toBe(17_124);
        expect(mongod.errmsg).toContain(
          `The argument to $size must be an array, but was of type: ${type}`,
        );
        expect(bsonTypeName(stored.p)).toBe(type);
        expect(await refusalOf(fetchOne(sized, query, n))).toEqual({
          refusal: "MONGOD_ERROR",
          detail: { fn: "count", type, column: 1 },
        });
      },
    );

    it("names the first count column that fails, as the evaluator does", async () => {
      await db.collection("sized").insertOne({ _id: "lists", p: "x", l: [1] });

      const twice = queryOf({
        columns: [
          { fn: "count", path: "l", as: "a" },
          { path: "code" },
          { fn: "count", path: "p", as: "b" },
          { fn: "count", path: "p", as: "c" },
        ],
      });

      expect(await refusalOf(fetchOne(sized, twice, "lists"))).toEqual({
        refusal: "MONGOD_ERROR",
        detail: { fn: "count", type: "string", column: 2 },
      });
    });
  });

  describe("unwound rows, against mongod's pipeline", () => {
    const unwound = sourceOf("unwound");
    const RECORD = {
      _id: 1,
      a: [{ x: 1, b: [1, 2] }, { x: 2, b: [] }, { x: 3 }, 5],
      c: "kept",
    };

    // mongod's own rows, and the positions includeArrayIndex gives them.
    const mongodRows = async (unwind, projection) => {
      const steps = (withIndex) =>
        unwind.map(({ path, preserve }, n) => ({
          $unwind: {
            path: `$${path}`,
            preserveNullAndEmptyArrays: preserve,
            ...(withIndex && { includeArrayIndex: `i${n}` }),
          },
        }));
      const positions = await db
        .collection("unwound")
        .aggregate([
          { $match: { _id: 1 } },
          ...steps(true),
          { $project: Object.fromEntries(unwind.map((_, n) => [`i${n}`, 1])) },
        ])
        .toArray();
      const docs = await db
        .collection("unwound")
        .aggregate(
          [
            { $match: { _id: 1 } },
            ...steps(false),
            ...(projection ? [{ $project: projection }] : []),
          ],
          { raw: true },
        )
        .toArray();

      return docs.map((doc, n) => ({
        doc: Buffer.from(doc),
        at: unwind.map((_, m) => {
          const at = positions[n][`i${m}`];

          return at === null || at === undefined ? null : Number(at);
        }),
      }));
    };

    beforeAll(async () => {
      await db.collection("unwound").insertOne(RECORD);
    });

    it.each([
      ["one unwind, whole", [{ path: "a", preserve: false }], null, null],
      [
        "one unwind, projected",
        [{ path: "a", preserve: false }],
        { "a.x": 1, c: 1 },
        [{ path: "a.x" }, { path: "c" }],
      ],
      [
        "two unwinds, the second preserving",
        [
          { path: "a", preserve: false },
          { path: "a.b", preserve: true },
        ],
        { "a.b": 1, n: { $size: "$a" } },
        null,
      ],
      [
        "two unwinds, projected",
        [
          { path: "a", preserve: false },
          { path: "a.b", preserve: true },
        ],
        { "a.b": 1, c: 1 },
        [{ path: "a.b" }, { path: "c" }],
      ],
    ])("%s", async (_, unwind, projection, columns) => {
      const expected = await mongodRows(unwind, columns ? projection : null);
      const query = queryOf({
        unwind,
        whole: !columns,
        columns: columns ?? [{ path: "_id" }],
      });
      const fetched = await fetchRows(
        unwound,
        query,
        expected.map(({ at }) => ({ box: boxOf(unwound), id: idText(1), at })),
      );

      expect(expected.length).toBeGreaterThan(3);
      expect(expected.some(({ at }) => at.includes(null))).toBe(
        unwind.length > 1,
      );
      fetched.forEach((entry, n) => {
        expect(docOf(entry).equals(expected[n].doc)).toBe(true);
      });
    });
  });

  describe("a record changed or gone since it was found", () => {
    const changing = sourceOf("changing");
    const where = { path: "status", op: "eq", values: ["open"] };
    const row = (_id, at = []) => ({
      box: boxOf(changing),
      id: idText(_id),
      at,
    });

    beforeAll(async () => {
      await db.collection("changing").insertMany([
        { _id: 1, status: "open", note: "a" },
        { _id: 2, status: "open", note: "b" },
        { _id: 3, status: "open", list: [{ v: 1 }, { v: 2 }, { v: 3 }] },
        { _id: 4, status: "open" },
      ]);
      await db
        .collection("changing")
        .updateOne({ _id: 1 }, { $set: { status: "closed" } });
      await db
        .collection("changing")
        .updateOne({ _id: 3 }, { $pop: { list: 1 } });
      await db.collection("changing").deleteOne({ _id: 4 });
    });

    it("says a record no longer passes the filter, and sends it as it now is", async () => {
      const [changed, same] = await fetchRows(
        changing,
        queryOf({ whole: true, where }),
        [row(1), row(2)],
      );

      expect(changed.changed).toBe(true);
      expect(docOf(changed).equals(await rawOf("changing", 1))).toBe(true);
      expect(same).not.toHaveProperty("changed");
      expect(same.doc).toBeTruthy();
    });

    it("says a record or an unwound element is gone", async () => {
      const [gone, element, kept] = await fetchRows(
        changing,
        queryOf({
          whole: true,
          where,
          unwind: [{ path: "list", preserve: false }],
        }),
        [row(4, [0]), row(3, [2]), row(3, [1])],
      );

      expect(gone).toMatchObject({ gone: true, context: null });
      expect(element).toMatchObject({ gone: true });
      expect(kept.doc).toBeTruthy();
    });
  });

  describe("the allowance", () => {
    const sized = sourceOf("allowance");
    const row = (_id) => ({ box: boxOf(sized), id: idText(_id), at: [] });

    beforeAll(async () => {
      await db
        .collection("allowance")
        .insertMany([1, 2, 3].map((_id) => ({ _id, text: "x".repeat(1000) })));
    });

    it("holds the first asked whatever its size, and leaves the rest unread", async () => {
      const [first, second, third] = await fetchRows(
        sized,
        queryOf({ whole: true }),
        [row(1), row(2), row(3)],
        1,
      );

      expect(first.doc).toBeTruthy();
      expect(second).toEqual({
        box: "gas.allowance",
        id: idText(2),
        at: [],
        unread: true,
        context: null,
      });
      expect(third.unread).toBe(true);
    });

    it("holds the first asked whatever order mongod reads them in", async () => {
      const fetched = await fetchRows(
        sized,
        queryOf({ whole: true }),
        [row(3), row(1), row(2)],
        1,
      );

      expect(fetched.map((entry) => Boolean(entry.doc))).toEqual([
        true,
        false,
        false,
      ]);
      expect(fetched[0].id).toBe(idText(3));
    });

    it("leaves unread every row after the first it lets go", async () => {
      const fetched = await fetchRows(
        sized,
        queryOf({ whole: true }),
        [row(1), row(3), row(2)],
        1500,
      );

      expect(fetched.map((entry) => Boolean(entry.unread))).toEqual([
        false,
        true,
        true,
      ]);
    });

    it("sends what fits, in the order asked", async () => {
      const fetched = await fetchRows(
        sized,
        queryOf({ whole: true }),
        [row(1), row(2), row(3)],
        2500,
      );

      expect(fetched.map((entry) => Boolean(entry.doc))).toEqual([
        true,
        true,
        false,
      ]);
    });
  });

  describe("a document mongod can't make in one reply", () => {
    const large = sourceOf("large");

    beforeAll(async () => {
      await db
        .collection("large")
        .insertOne({ _id: 1, big: "x".repeat(9 * MIB) });
    });

    it("is too large where a projection makes it so", async () => {
      const entry = await fetchOne(
        large,
        queryOf({
          columns: [
            { path: "big", as: "a" },
            { path: "big", as: "b" },
          ],
        }),
        1,
      );

      expect(entry).toMatchObject({ tooLarge: true, context: null });
      expect(entry).not.toHaveProperty("doc");
    });

    it("comes whole without the filter's test where only that made it too large", async () => {
      const entry = await fetchOne(
        large,
        queryOf({
          whole: true,
          where: { path: "big", op: "filled", values: [] },
        }),
        1,
      );

      expect(docOf(entry).equals(await rawOf("large", 1))).toBe(true);
      expect(entry).not.toHaveProperty("changed");
    });

    it("still tests the filter on the record it came without", async () => {
      const entry = await fetchOne(
        large,
        queryOf({
          whole: true,
          where: { path: "big", op: "eq", values: ["y"] },
        }),
        1,
      );

      expect(docOf(entry).equals(await rawOf("large", 1))).toBe(true);
      expect(entry.changed).toBe(true);
    });
  });

  describe("records a small source attaches", () => {
    const things = sourceOf("things", {
      attach: [{ as: "owner", collection: "owners", on: [["owner", "key"]] }],
    });
    const row = (_id) => ({ box: boxOf(things), id: idText(_id), at: [] });

    beforeAll(async () => {
      await db.collection("things").insertMany([
        { _id: "t1", ref: "T-1", owner: "o1" },
        { _id: "t2", ref: "T-2", owner: "o2" },
        { _id: "t3", ref: "T-3", owner: "o3" },
      ]);
      await db.collection("owners").insertMany([
        { key: "o1", name: "Hilltop Farm", since: 1999 },
        { key: "o2", name: "Lower Brook", since: 2004 },
        { key: "o3", name: "Old Mill", since: 2010 },
      ]);
    });

    it("sends each shown row's, as mongod projects the paths named in it, and reads no other", async () => {
      const find = vi.spyOn(Collection.prototype, "find");
      const fetched = await fetchRows(
        things,
        queryOf({
          columns: [{ path: "ref" }, { path: "owner.name" }],
          where: { path: "owner.name", op: "ne", values: ["Old Mill"] },
        }),
        [row("t1"), row("t2")],
      );
      const [owner] = await db
        .collection("owners")
        .find({ key: "o1" }, { raw: true, projection: { name: 1 } })
        .toArray();
      const ownerReads = find.mock.calls.filter(
        (_, n) => find.mock.contexts[n].collectionName === "owners",
      );

      expect(
        docOf(fetched[0]).equals(
          await rawOf("things", "t1", { ref: 1, "owner.name": 1 }),
        ),
      ).toBe(true);
      expect(
        Buffer.from(fetched[0].context.owner, "base64").equals(
          Buffer.from(owner),
        ),
      ).toBe(true);
      expect(ownerReads).toHaveLength(3);
      expect(JSON.stringify(ownerReads.slice(1))).not.toContain("o3");
      expect(fetched.map((entry) => entry.changed ?? false)).toEqual([
        false,
        false,
      ]);
    });

    it("charges each row its joined record, and leaves unread the rows past what it holds", async () => {
      const query = queryOf({ columns: [{ path: "ref" }, { path: "owner" }] });
      const [whole] = await fetchRows(things, query, [row("t1")]);
      const rowBytes =
        docOf(whole).length + Buffer.byteLength(whole.context.owner, "base64");
      const fetched = await fetchRows(
        things,
        query,
        [row("t1"), row("t2"), row("t3")],
        rowBytes + 10,
      );

      expect(fetched.map((entry) => Boolean(entry.doc))).toEqual([
        true,
        false,
        false,
      ]);
      expect(fetched[1]).toMatchObject({ unread: true, context: null });
    });

    it("tests the filter on the record it attaches, as it now is", async () => {
      await db
        .collection("owners")
        .updateOne({ key: "o2" }, { $set: { name: "Old Mill" } });

      const [, renamed] = await fetchRows(
        things,
        queryOf({
          columns: [{ path: "ref" }],
          where: { path: "owner.name", op: "ne", values: ["Old Mill"] },
        }),
        [row("t1"), row("t2")],
      );

      expect(renamed.changed).toBe(true);
    });
  });

  describe("a big source's boxes", () => {
    const led = ledBucket({
      id: "test.led",
      path: "test/led",
      collection: "led",
    });
    const events = {
      name: "events",
      label: "Events",
      service: "Test",
      size: "big",
      noun: { one: "event", many: "events" },
      time: "publicationDate",
      star: [],
      added: { box: (_, { box }) => [box] },
      boxes: [
        { id: "test.outbox", bucket: outbox(), service: "Test", box: "outbox" },
        { id: "test.led", bucket: led, service: "Test", box: "led" },
      ],
      open: () => null,
      openPaths: [],
      paths: [],
    };
    const ids = {
      out: new ObjectId(),
      inLine: new ObjectId(),
      offLine: new ObjectId(),
    };

    beforeAll(async () => {
      await db.collection("outbox").insertOne({
        _id: ids.out,
        publicationDate: new Date(),
        status: "FAILED",
      });
      await db.collection("led").insertMany([
        { _id: ids.inLine, publicationDate: new Date(), eventType: "audit" },
        { _id: ids.offLine, publicationDate: new Date(), eventType: "other" },
      ]);
    });

    it("says each row's service and box beside it, sent or not", async () => {
      const [sent, gone] = await fetchRows(events, queryOf({ whole: true }), [
        { box: "test.outbox", id: idText(ids.out), at: [] },
        { box: "test.outbox", id: idText(new ObjectId()), at: [] },
      ]);

      expect(sent.context).toEqual({ service: "Test", box: "outbox" });
      expect(gone).toMatchObject({
        gone: true,
        context: { service: "Test", box: "outbox" },
      });
    });

    it("fetches no record outside the box's bucket line", async () => {
      const [inLine, offLine] = await fetchRows(
        events,
        queryOf({ whole: true }),
        [
          { box: "test.led", id: idText(ids.inLine), at: [] },
          { box: "test.led", id: idText(ids.offLine), at: [] },
        ],
      );

      expect(inLine.doc).toBeTruthy();
      expect(offLine).toMatchObject({ gone: true });
    });

    it("reads by _id, raw, within the deadline, never spilling to disk", async () => {
      const aggregate = vi.spyOn(Collection.prototype, "aggregate");

      await fetchRows(events, queryOf({ whole: true }), [
        { box: "test.outbox", id: idText(ids.out), at: [] },
      ]);

      const [[pipeline, options]] = aggregate.mock.calls;

      expect(pipeline[0].$match).toEqual({
        $and: [{ _id: { $in: [ids.out] } }],
      });
      expect(options).toMatchObject({
        raw: true,
        hint: { _id: 1 },
        readPreference: "secondaryPreferred",
        allowDiskUse: false,
      });
      expect(options.maxTimeMS).toBeGreaterThan(0);
      expect(options.maxTimeMS).toBeLessThanOrEqual(20_000);
    });

    it("fetches a bucket box's records through the read-only view alone", async () => {
      const spied = spyCollections();

      await fetchRows(events, queryOf({ whole: true }), [
        { box: "test.outbox", id: idText(ids.out), at: [] },
        { box: "test.led", id: idText(ids.inLine), at: [] },
      ]);
      await fetchRows(events, queryOf({ columns: [{ path: "status" }] }), [
        { box: "test.outbox", id: idText(ids.out), at: [] },
      ]);

      expectReadsOnly(spied);
    });

    it("refuses a box the source has none of, and an _id that isn't one", async () => {
      expect(
        await refusalOf(
          fetchRows(events, queryOf({ whole: true }), [
            { box: "test.inbox", id: idText(ids.out), at: [] },
          ]),
        ),
      ).toMatchObject({ refusal: "INVALID" });
      expect(
        await refusalOf(
          fetchRows(events, queryOf({ whole: true }), [
            {
              box: "test.outbox",
              id: BSON.serialize({ other: 1 }).toString("base64"),
              at: [],
            },
          ]),
        ),
      ).toMatchObject({ refusal: "INVALID" });
    });
  });

  describe("reading only", () => {
    const viewed = sourceOf("viewed", {
      attach: [
        { as: "owner", collection: "viewedOwners", on: [["owner", "key"]] },
      ],
    });
    const row = (_id, at = []) => ({ box: boxOf(viewed), id: idText(_id), at });
    beforeAll(async () => {
      await db.collection("viewed").insertMany([
        { _id: 1, status: "open", owner: "o1", list: [{ v: 1 }, { v: 2 }] },
        { _id: 2, status: "closed", owner: "o1", p: "x" },
        { _id: 3, status: "open", big: "x".repeat(9 * MIB) },
      ]);
      await db.collection("viewedOwners").insertOne({ key: "o1", name: "A" });
    });

    it("reads every shape through the read-only view, by pipelines that write nothing", async () => {
      const spied = spyCollections();
      const where = { path: "status", op: "eq", values: ["open"] };

      await fetchRows(viewed, queryOf({ whole: true, where }), [
        row(1),
        row(2),
        row(4),
      ]);
      await fetchRows(
        viewed,
        queryOf({
          columns: [{ path: "status" }, { path: "owner.name" }],
          where,
        }),
        [row(1), row(2)],
      );
      await fetchRows(
        viewed,
        queryOf({ whole: true, unwind: [{ path: "list", preserve: false }] }),
        [row(1, [0]), row(1, [1])],
      );
      await refusalOf(
        fetchRows(
          viewed,
          queryOf({
            columns: [
              { fn: "count", path: "list", as: "a" },
              { fn: "count", path: "p", as: "b" },
            ],
          }),
          [row(2)],
        ),
      );
      await fetchRows(
        viewed,
        queryOf({
          whole: true,
          where: { path: "big", op: "eq", values: ["y"] },
        }),
        [row(3)],
      );

      expect(new Set(spied.reads.map(({ name }) => name))).toEqual(
        new Set(["find", "aggregate"]),
      );
      expectReadsOnly(spied);
    });
  });

  describe("starts", () => {
    const startsOf = (asked) => {
      const query = queryOf(asked);

      return { ...query, documents: { ...query.documents, mode: "starts" } };
    };
    const startRows = (source, query, rows, asked = meter()) =>
      fetchDocuments(source, query, { rows, meter: asked });
    const startDoc = (entry) => Buffer.from(entry.start.doc, "base64");
    const isStartOf = async (entry, collection, _id, projection) => {
      const raw = await rawOf(collection, _id, projection);
      const start = startOf(raw);

      return (
        startDoc(entry).equals(start.doc) &&
        entry.start.cut === start.cut &&
        entry.printed.bytes === raw.length &&
        entry.printed.values === valuesOf(raw)
      );
    };

    describe("a page of 50 records of 4 MB", () => {
      const heavy = sourceOf("heavy");
      const ids = Array.from({ length: 50 }, () => new ObjectId());
      const rows = ids.map((_id) => ({
        box: boxOf(heavy),
        id: idText(_id),
        at: [],
      }));

      beforeAll(async () => {
        for (const [n, _id] of ids.entries()) {
          await db.collection("heavy").insertOne({
            _id,
            ref: `H-${n}`,
            body: "h".repeat(4 * MIB),
          });
        }
      }, 120_000);

      it("cuts each record's start as it is read, neither too slow nor too costly", async () => {
        const before = process.memoryUsage();
        const starts = await startRows(heavy, startsOf({ whole: true }), rows);
        const after = process.memoryUsage();

        expect(starts).toHaveLength(50);
        expect(
          starts.every((entry) => startDoc(entry).length <= START_BYTES),
        ).toBe(true);
        expect(await isStartOf(starts[0], "heavy", ids[0])).toBe(true);
        expect(await isStartOf(starts[49], "heavy", ids[49])).toBe(true);
        expect(starts[0].start.cut).toBe(true);
        expect(after.heapUsed - before.heapUsed).toBeLessThan(150 * MIB);
      }, 60_000);

      it("ends at the first record not read in the order asked, out of work", async () => {
        const starts = await startRows(
          heavy,
          startsOf({ whole: true }),
          rows,
          meterFor(Date.now() + 20_000, 6),
        );

        expect(starts.length).toBeGreaterThan(0);
        expect(starts.length).toBeLessThan(50);
        expect(starts.map(({ id }) => id)).toEqual(
          rows.slice(0, starts.length).map(({ id }) => id),
        );
        expect(starts.every(({ start }) => start)).toBe(true);
      }, 60_000);

      it("reads none with no time left but its reserve, and says so by sending none", async () => {
        const starts = await startRows(
          heavy,
          startsOf({ whole: true }),
          rows,
          meterFor(Date.now() + START_RESERVE_MS - 1),
        );

        expect(starts).toEqual([]);
      });
    });

    describe("changed and gone", () => {
      const changing = sourceOf("changing");
      const where = { path: "status", op: "eq", values: ["open"] };
      const row = (_id, at = []) => ({
        box: boxOf(changing),
        id: idText(_id),
        at,
      });

      it("says a record no longer passes the filter, cutting it as it now is", async () => {
        const [changed, same] = await startRows(
          changing,
          startsOf({ whole: true, where }),
          [row(1), row(2)],
        );

        expect(changed.changed).toBe(true);
        expect(await isStartOf(changed, "changing", 1)).toBe(true);
        expect(same).not.toHaveProperty("changed");
        expect(Object.keys(same).sort()).toEqual(
          ["at", "box", "id", "printed", "start"].sort(),
        );
      });

      it("says a record or an unwound element is gone, and cuts the unwound row mongod makes", async () => {
        const query = startsOf({
          whole: true,
          where,
          unwind: [{ path: "list", preserve: false }],
        });
        const [gone, element, kept] = await startRows(changing, query, [
          row(4, [0]),
          row(3, [2]),
          row(3, [1]),
        ]);
        const [unwound] = await fetchRows(
          changing,
          { ...query, documents: { whole: true, id: true } },
          [row(3, [1])],
        );

        expect(gone).toEqual({ ...row(4, [0]), gone: true });
        expect(element).toEqual({ ...row(3, [2]), gone: true });
        expect(startDoc(kept).equals(startOf(docOf(unwound)).doc)).toBe(true);
      });
    });

    it("counts what a projection prints, a value it repeats each time", async () => {
      const repeated = sourceOf("repeated");
      const _id = new ObjectId();

      await db
        .collection("repeated")
        .insertOne({ _id, big: "r".repeat(600 * 1024), small: 1 });

      const columns = Array.from({ length: 10 }, (_, n) => ({
        path: "big",
        as: `b${n}`,
      }));
      const [entry] = await startRows(repeated, startsOf({ columns }), [
        { box: boxOf(repeated), id: idText(_id), at: [] },
      ]);
      const [projected] = await fetchRows(repeated, queryOf({ columns }), [
        { box: boxOf(repeated), id: idText(_id), at: [] },
      ]);

      expect(entry.printed).toEqual({
        bytes: docOf(projected).length,
        values: 11,
      });
      expect(entry.printed.bytes).toBeGreaterThan(10 * 600 * 1024);
      expect(startDoc(entry).equals(startOf(docOf(projected)).doc)).toBe(true);
    });

    it("tests the filter on a record a small source attaches, sending none of it", async () => {
      const things = sourceOf("things", {
        attach: [{ as: "owner", collection: "owners", on: [["owner", "key"]] }],
      });
      const row = (_id) => ({ box: boxOf(things), id: idText(_id), at: [] });
      const starts = await startRows(
        things,
        startsOf({
          columns: [{ path: "ref" }, { path: "owner.name" }],
          where: { path: "owner.name", op: "ne", values: ["Old Mill"] },
        }),
        [row("t1"), row("t2")],
      );

      expect(starts.map((entry) => entry.changed ?? false)).toEqual([
        false,
        true,
      ]);
      expect(starts.every((entry) => !("context" in entry))).toBe(true);
      expect(
        await isStartOf(starts[0], "things", "t1", { ref: 1, "owner.name": 1 }),
      ).toBe(true);
    });

    it("charges its own work, whatever the read before it spent", async () => {
      const spent = { ...meterFor(Date.now() + 20_000, 100), spent: 1000 };
      const starts = await startRows(
        sourceOf("things"),
        startsOf({ whole: true }),
        ["t1", "t2", "t3"].map((_id) => ({
          box: "gas.things",
          id: idText(_id),
          at: [],
        })),
        spent,
      );

      expect(starts).toHaveLength(3);
      expect(spent.spent).toBe(1000);
    });

    it("keeps the rows read with their joined records' tests when the work budget runs out", async () => {
      const things = sourceOf("things", {
        attach: [{ as: "owner", collection: "owners", on: [["owner", "key"]] }],
      });
      const row = (_id) => ({ box: boxOf(things), id: idText(_id), at: [] });
      const query = {
        ...startsOf({
          columns: [{ path: "ref" }],
          where: { path: "owner.name", op: "ne", values: ["Old Mill"] },
        }),
        rows: [row("t1"), row("t2"), row("t3")],
      };
      const part = await fetchPart(
        things,
        query,
        meterFor(Date.now() + 20_000, 1),
      );
      const whole = await fetchPart(things, query, meter());

      expect(part.documents.map(({ id }) => id)).toEqual(
        query.rows.slice(0, 2).map(({ id }) => id),
      );
      expect(part.documents.every(({ start }) => start)).toBe(true);
      expect(part.ended).toBe("work");
      expect(whole.documents).toHaveLength(3);
      expect(whole.documents[2].changed).toBe(true);
      expect(whole).not.toHaveProperty("ended");
    });

    it("keeps the rows read with their joined records' tests when mongod's time runs out", async () => {
      const things = sourceOf("things", {
        attach: [{ as: "owner", collection: "owners", on: [["owner", "key"]] }],
      });
      const row = (_id) => ({ box: boxOf(things), id: idText(_id), at: [] });
      const find = Collection.prototype.find;

      vi.spyOn(Collection.prototype, "find").mockImplementation(
        function (filter, options) {
          const cursor = find.call(this, filter, options);

          if (
            this.collectionName === "owners" &&
            JSON.stringify(filter).includes("o2")
          ) {
            cursor[Symbol.asyncIterator] = async function* () {
              yield* [];
              throw new MongoServerError({
                code: 50,
                codeName: "MaxTimeMSExpired",
                errmsg: "operation exceeded time limit",
              });
            };
          }

          return cursor;
        },
      );

      const part = await fetchPart(
        things,
        {
          ...startsOf({
            columns: [{ path: "ref" }],
            where: { path: "owner.name", op: "ne", values: ["Old Mill"] },
          }),
          rows: [row("t1"), row("t2"), row("t3")],
        },
        meter(),
      );

      expect(part.documents.map(({ id }) => id)).toEqual([idText("t1")]);
      expect(part.ended).toBe("time");
    });

    it("cuts every BSON type and key as stored", async () => {
      const _id = new ObjectId();

      await db.collection("typed").insertOne(everyType(_id));

      const [entry] = await startRows(
        sourceOf("typed"),
        startsOf({ whole: true }),
        [{ box: "gas.typed", id: idText(_id), at: [] }],
      );

      expect(await isStartOf(entry, "typed", _id)).toBe(true);
    });
  });

  describe("a row asked more than once", () => {
    const repeated = sourceOf("repeated");
    const row = (_id, at = []) => ({
      box: boxOf(repeated),
      id: idText(_id),
      at,
    });

    beforeAll(async () => {
      await db.collection("repeated").insertMany([
        { _id: 1, list: ["a", "b"] },
        { _id: 2, note: "n" },
      ]);
    });

    it("sends its document each time it is asked", async () => {
      const entries = await fetchRows(repeated, queryOf({ whole: true }), [
        row(1),
        row(2),
        row(1),
      ]);
      const raw = await rawOf("repeated", 1);

      expect(entries.map((entry) => docOf(entry).equals(raw))).toEqual([
        true,
        false,
        true,
      ]);
      expect(entries.some((entry) => entry.gone)).toBe(false);
    });

    it("sends an unwound row each time it is asked", async () => {
      const entries = await fetchRows(
        repeated,
        queryOf({ whole: true, unwind: [{ path: "list", preserve: false }] }),
        [row(1, [1]), row(1, [1])],
      );

      expect(entries.every((entry) => entry.doc)).toBe(true);
    });

    it("cuts its start each time it is asked in one round", async () => {
      const query = queryOf({ whole: true });
      const entries = await fetchDocuments(
        repeated,
        { ...query, documents: { ...query.documents, mode: "starts" } },
        { rows: [row(2), row(1), row(1)], meter: meter() },
      );

      expect(entries.map((entry) => Boolean(entry.start))).toEqual([
        true,
        true,
        true,
      ]);
    });
  });

  describe("only _id asked, without _id", () => {
    const bare = sourceOf("bare");
    const asked = [{ box: boxOf(bare), id: idText(1), at: [] }];
    const query = queryOf({ columns: [{ path: "_id" }], id: false });

    beforeAll(async () => {
      await db.collection("bare").insertOne({ _id: 1, note: "n" });
    });

    it("sends an empty document, as mongod projects it", async () => {
      const [entry] = await fetchRows(bare, query, asked);

      expect(docOf(entry).equals(BSON.serialize({}))).toBe(true);
    });

    it("cuts the empty document's start", async () => {
      const [entry] = await fetchDocuments(
        bare,
        { ...query, documents: { ...query.documents, mode: "starts" } },
        { rows: asked, meter: meter() },
      );

      expect(
        Buffer.from(entry.start.doc, "base64").equals(BSON.serialize({})),
      ).toBe(true);
    });
  });

  describe("the filter tested again on a long value", () => {
    const long = sourceOf("long");
    const where = {
      path: "text",
      op: "regex",
      values: [{ pattern: "(?:(?:a|.){20}){4}z", flags: "" }],
    };
    const asked = [1, 2, 3].map((_id) => ({
      box: boxOf(long),
      id: idText(_id),
      at: [],
    }));

    beforeAll(async () => {
      await db
        .collection("long")
        .insertMany(
          [1, 2, 3].map((_id) => ({ _id, text: "a".repeat(100_000) })),
        );
    });

    it("refuses a fetch whose test is more work than the budget left", async () => {
      expect(
        await refusalOf(
          fetchDocuments(long, queryOf({ whole: true, where }), {
            rows: asked,
            meter: meterFor(Date.now() + 20_000, 10_000),
            bytes: 16 * MIB,
          }),
        ),
      ).toMatchObject({ refusal: "TOO_COSTLY" });
    });

    it("never holds the event loop past 100 ms however long its test", async () => {
      let last = Date.now();
      let worst = 0;
      const timer = setInterval(() => {
        worst = Math.max(worst, Date.now() - last);
        last = Date.now();
      }, 5);

      await refusalOf(
        fetchDocuments(long, queryOf({ whole: true, where }), {
          rows: asked,
          meter: meterFor(Date.now() + 20_000, Infinity),
          bytes: 16 * MIB,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      clearInterval(timer);

      expect(worst).toBeLessThan(100);
    });

    it("ends a starts fetch out of work at the first row it can't test", async () => {
      const query = queryOf({ whole: true, where });
      const part = await fetchPart(
        long,
        {
          ...query,
          documents: { ...query.documents, mode: "starts" },
          rows: asked,
        },
        meterFor(Date.now() + 20_000, 10_000),
      );

      expect(part).toEqual({ documents: [], ended: "work" });
    });
  });

  it("logs no stored value", () => {
    expect(JSON.stringify(logged)).not.toContain(SENTINEL);
  });
});
