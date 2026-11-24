import {
  BSON,
  BSONRegExp,
  Binary,
  Double,
  Int32,
  Long,
  ObjectId,
} from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  expectReadsOnly,
  spyCollections,
} from "../../../test/helpers/explore-read-only.js";
import {
  ODD_ELEMENTS,
  documentOf,
  objectIdElement,
  rawInsert,
  stringElement,
} from "../../../test/helpers/raw-bson.js";

vi.mock("../logger.js");

const DATABASE = "explore_stored_scratch";
const COLLECTION = "records";
const KIB = 1024;
const MIB = 1024 * KIB;

let replSet;
let uri;
let mongoClient;
let db;
let readStoredDocuments;
let RAW_CAP_BYTES;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  uri = replSet.getUri();

  vi.stubEnv("MONGO_URI", uri);
  vi.stubEnv("MONGO_DATABASE", DATABASE);
  vi.resetModules();

  ({ mongoClient, db } = await import("../mongo-client.js"));
  ({ readStoredDocuments, RAW_CAP_BYTES } =
    await import("./stored-document.js"));

  await mongoClient.connect();
  await db.dropDatabase();
}, 120_000);

afterAll(async () => {
  await db?.dropDatabase();
  await mongoClient?.close();
  await replSet?.stop();
});

const storedOf = async (_id, projection) => {
  const [buf] = await db
    .collection(COLLECTION)
    .find({ _id }, { raw: true, projection })
    .toArray();

  return Buffer.from(buf);
};

const readOne = async (_id, options = {}) => {
  const found = await readStoredDocuments(COLLECTION, {
    match: { _id },
    maxBytes: RAW_CAP_BYTES,
    ...options,
  });

  expect(found).toHaveLength(1);

  return found[0];
};

const oddRecord = (_id) =>
  documentOf([
    objectIdElement("_id", _id),
    ...ODD_ELEMENTS,
    stringElement("comments", "notes"),
  ]);

const padded = (_id, bytes) => {
  const record = { _id, pad: "" };
  const overhead = BSON.calculateObjectSize(record);

  return { _id, pad: "x".repeat(bytes - overhead) };
};

describe("readStoredDocuments against mongod", () => {
  it("gives a record's bytes exactly as stored, every type, key and duplicate kept", async () => {
    const _id = new ObjectId();

    await rawInsert(uri, DATABASE, COLLECTION, [oddRecord(_id)]);

    const stored = await storedOf(_id);
    const found = await readOne(_id);

    expect(found.document.equals(stored)).toBe(true);
    expect(found.storedBytes).toBe(stored.length);
  });

  it("leaves out each field unset, the rest as stored, its size the whole record's", async () => {
    const _id = new ObjectId();

    await rawInsert(uri, DATABASE, COLLECTION, [oddRecord(_id)]);

    const whole = await storedOf(_id);
    const found = await readOne(_id, { unset: ["comments"] });

    expect(found.document.equals(await storedOf(_id, { comments: 0 }))).toBe(
      true,
    );
    expect(found.storedBytes).toBe(whole.length);
  });

  it("sets each field from the record in its place, its size measured before", async () => {
    const _id = new ObjectId();
    const record = { _id, a: 1, id: "f".repeat(64), z: 2 };

    await db.collection(COLLECTION).insertOne(record);

    const found = await readOne(_id, {
      set: { id: { $concat: [{ $substrCP: ["$id", 0, 3] }, "…"] } },
    });

    expect(BSON.deserialize(found.document)).toEqual({
      ...record,
      id: "fff…",
    });
    expect(Object.keys(BSON.deserialize(found.document))).toEqual([
      "_id",
      "a",
      "id",
      "z",
    ]);
    expect(found.storedBytes).toBe(BSON.calculateObjectSize(record));
    expect(found.document.toString("latin1")).not.toContain("f".repeat(64));
  });

  it.each([
    ["900 KiB", 900 * KIB, true],
    ["1 MiB", MIB, true],
    ["1 MiB and 1 byte", MIB + 1, false],
    ["2 MiB", 2 * MIB, false],
  ])(
    "gives a record of %s whole only within the cap",
    async (_, bytes, shown) => {
      const _id = new ObjectId();

      await db.collection(COLLECTION).insertOne(padded(_id, bytes));

      const found = await readOne(_id);

      expect(found.storedBytes).toBe(bytes);
      expect(found.document?.length ?? null).toBe(shown ? bytes : null);
    },
  );

  it("gives every record matched, up to the limit", async () => {
    const batch = new ObjectId().toHexString();

    await db.collection(COLLECTION).insertMany([
      { batch, n: new Int32(1), at: new Date(0) },
      { batch, n: Long.fromNumber(2), re: new BSONRegExp("x", "i") },
      { batch, n: new Double(3), bin: new Binary(Buffer.alloc(32), 0) },
    ]);

    const all = await readStoredDocuments(COLLECTION, {
      match: { batch },
      maxBytes: RAW_CAP_BYTES,
    });
    const one = await readStoredDocuments(COLLECTION, {
      match: { batch },
      maxBytes: RAW_CAP_BYTES,
      limit: 1,
    });

    expect(all).toHaveLength(3);
    expect(one).toHaveLength(1);
  });

  it("reads only through Explore's read-only view", async () => {
    const spied = spyCollections();

    await readStoredDocuments(COLLECTION, {
      match: {},
      unset: ["comments"],
      maxBytes: RAW_CAP_BYTES,
      maxTimeMS: 5000,
      readPreference: "primary",
    });

    expectReadsOnly(spied);
  });
});
