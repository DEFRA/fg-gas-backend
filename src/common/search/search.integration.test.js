import { Collection, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { declarationOf } from "./declarations.js";
import { ensureSearchIndexes } from "./document.js";
import { stampOf } from "./signature.js";

vi.mock("../logger.js");

const search = {
  fields: [
    {
      key: "businessName",
      label: "Business name",
      path: "$.answers.business.name",
      match: "prefix",
    },
    {
      key: "parcelId",
      label: "Parcel ID",
      path: "$.answers.parcels[*].id",
    },
  ],
};

const id = (n) =>
  ObjectId.createFromHexString(n.toString(16).padStart(24, "0"));

const record = (n, answers, code = "grant-a") => ({
  _id: id(n),
  code,
  createdAt: new Date(
    Date.UTC(2026, 9, 1, 0, 0, Math.floor(n / 2)),
  ).toISOString(),
  answers,
});

let replSet;
let mongoClient;
let db;
let store;
let logger;
let SearchReindexer;
let SearchSweeper;
let defineSearchSource;
let findCurrentSearches;
let recordConfigChange;
let source;
let listed;

const sourceListing = (listDeclarations, ttlMs = 0) =>
  defineSearchSource({
    collection: "record_search",
    records: "records",
    lead: "code",
    projection: { answers: 1 },
    viewOf: ({ answers }) => ({ answers }),
    listDeclarations,
    ttlMs,
  });

const reindexerOf = (from) => {
  const built = new SearchReindexer({ source: from, intervalMs: 1000 });
  built.running = true;

  return built;
};

const EARLIER = 1;
const LATER = 2;

const searchDocs = () =>
  db
    .collection("record_search")
    .find({}, { sort: { _id: 1 } })
    .toArray();

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", "search-test");
  vi.resetModules();

  ({ mongoClient, db } = await import("../mongo-client.js"));
  ({ logger } = await import("../logger.js"));
  store = await import("./store.js");
  ({ SearchReindexer } = await import("./reindexer.js"));
  ({ SearchSweeper } = await import("./sweeper.js"));
  ({ defineSearchSource } = await import("./source.js"));
  ({ findCurrentSearches, recordConfigChange } =
    await import("./current-searches.js"));

  source = sourceListing(async () => listed);

  await mongoClient.connect();
}, 120_000);

afterAll(async () => {
  await mongoClient?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  listed = [{ value: "grant-a", search }];
  await db.dropDatabase();
  await ensureSearchIndexes(db, source);
});

describe("ensureSearchIndexes", () => {
  it("builds the search and the reindexer's index, and none twice", async () => {
    await ensureSearchIndexes(db, source);

    const indexes = await db.collection("record_search").indexes();

    expect(indexes.map(({ key }) => key)).toEqual([
      { _id: 1 },
      { code: 1, keys: 1, createdAt: -1, _id: -1 },
      { code: 1, sig: 1, stamp: 1 },
    ]);
  });
});

describe("indexRecord", () => {
  it("replaces the record's search document with what it says now", async () => {
    await store.indexRecord(
      source,
      record(1, {
        business: { name: "Hilltop Farm" },
        parcels: [{ id: "SX1" }],
      }),
    );
    await store.indexRecord(
      source,
      record(1, { business: { name: "Valley Farm" } }),
    );

    expect(await searchDocs()).toEqual([
      {
        _id: id(1),
        code: "grant-a",
        createdAt: record(1).createdAt,
        keys: ["businessName:valleyfarm"],
        sig: declarationOf(search).sig,
        stamp: declarationOf(search).stamp,
      },
    ]);
  });

  it("gives a record of an undeclared grant a document with no keys", async () => {
    await store.indexRecord(
      source,
      record(2, { business: { name: "x" } }, "grant-b"),
    );

    expect(await searchDocs()).toEqual([
      expect.objectContaining({
        _id: id(2),
        keys: [],
        sig: declarationOf(null).sig,
      }),
    ]);
  });

  it("writes in the caller's session, so it aborts with the record", async () => {
    const session = mongoClient.startSession();

    await expect(
      session.withTransaction(async () => {
        await store.indexRecord(source, record(3, {}), session);
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    await session.endSession();

    expect(await searchDocs()).toEqual([]);
  });

  it("never replaces a document built from a later declaration, but leaves it to be rebuilt", async () => {
    const later = declarationOf(search, LATER);
    await db.collection("record_search").insertOne({
      _id: id(5),
      code: "grant-a",
      createdAt: record(5).createdAt,
      keys: ["businessName:hilltopfarm"],
      sig: later.sig,
      stamp: later.stamp,
    });
    listed = [{ value: "grant-a", search: null, change: EARLIER }];

    await store.indexRecord(
      source,
      record(5, { business: { name: "Valley Farm" } }),
    );

    expect(await searchDocs()).toEqual([
      expect.objectContaining({
        keys: ["businessName:hilltopfarm"],
        sig: null,
        stamp: later.stamp,
      }),
    ]);
  });

  it("reads the declarations afresh before it gives up on a document built from a later one", async () => {
    const later = declarationOf(search, LATER);
    const listing = vi
      .fn()
      .mockResolvedValueOnce([
        { value: "grant-a", search: null, change: EARLIER },
      ])
      .mockResolvedValue([{ value: "grant-a", search, change: LATER }]);
    await db.collection("record_search").insertOne({
      _id: id(6),
      code: "grant-a",
      createdAt: record(6).createdAt,
      keys: ["businessName:hilltopfarm"],
      sig: later.sig,
      stamp: later.stamp,
    });

    await store.indexRecord(
      sourceListing(listing, 60_000),
      record(6, { business: { name: "Valley Farm" } }),
    );

    expect(listing).toHaveBeenCalledTimes(2);
    expect(await searchDocs()).toEqual([
      expect.objectContaining({
        keys: ["businessName:valleyfarm"],
        sig: later.sig,
        stamp: later.stamp,
      }),
    ]);
  });

  it("marks out of date a document a later declaration rebuilt between its read and its replace", async () => {
    const later = declarationOf(search, LATER);
    const before = record(7, { business: { name: "Hilltop Farm" } });
    const written = record(7, { business: { name: "Valley Farm" } });
    await db.collection("records").insertOne(written);
    await store.indexRecord(source, before);
    const rebuildMeanwhile = async () => {
      await db
        .collection("record_search")
        .updateOne(
          { _id: id(7) },
          { $set: { sig: later.sig, stamp: later.stamp } },
        );

      return [{ value: "grant-a", search, change: EARLIER }];
    };

    await store.indexRecord(sourceListing(rebuildMeanwhile), written);

    expect(await searchDocs()).toEqual([
      expect.objectContaining({
        keys: ["businessName:hilltopfarm"],
        sig: null,
        stamp: later.stamp,
      }),
    ]);

    await reindexerOf(
      sourceListing(async () => [{ value: "grant-a", search, change: LATER }]),
    ).reindex();

    expect(await searchDocs()).toEqual([
      expect.objectContaining({
        keys: ["businessName:valleyfarm"],
        sig: later.sig,
        stamp: later.stamp,
      }),
    ]);
  });

  it("warns with counts and keys, never values, of what it left out", async () => {
    await store.indexRecord(
      source,
      record(4, { business: { name: { secret: "Hidden Value" } } }),
    );

    expect(logger.warn).toHaveBeenCalledWith(
      "Search record_search: values not indexed on 1 records: businessName (1 not text, 0 over the caps)",
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(/hidden/i);
  });
});

describe("readSearchPage", () => {
  beforeEach(async () => {
    for (let n = 1; n <= 9; n += 1) {
      await store.indexRecord(
        source,
        record(n, {
          business: { name: n % 3 === 0 ? "Hilltop Farm" : `Hillside ${n}` },
          parcels: [{ id: `SX${n % 2}` }],
        }),
      );
    }

    await store.indexRecord(
      source,
      record(10, { business: { name: "Hilltop Farm" } }, "grant-b"),
    );
  });

  const read = (field, options = {}) =>
    store.readSearchPage(source, {
      value: "grant-a",
      field,
      limit: 20,
      maxTimeMS: 5000,
      ...options,
    });

  const ids = (docs) => docs.map(({ _id }) => _id.toString());

  it("finds an exact value, newest first, within the lead value", async () => {
    expect(
      ids(await read({ key: "parcelId", match: "exact", value: "sx1" })),
    ).toEqual([9, 7, 5, 3, 1].map((n) => id(n).toString()));
  });

  it("finds a prefix, never another field's value", async () => {
    expect(
      ids(
        await read({ key: "businessName", match: "prefix", value: "hilltop" }),
      ),
    ).toEqual([9, 6, 3].map((n) => id(n).toString()));
    expect(
      await read({ key: "parcel", match: "prefix", value: "idsx" }),
    ).toEqual([]);
  });

  it("treats a searched value as text, never as a pattern", async () => {
    expect(
      await read({ key: "businessName", match: "prefix", value: ".*" }),
    ).toEqual([]);
  });

  it("pages after a position and within a range", async () => {
    const field = { key: "businessName", match: "prefix", value: "hill" };
    const [first, second] = await read(field, { limit: 2 });
    const after = await read(field, {
      after: { t: second.createdAt, i: second._id },
    });

    expect(ids([first, second])).toEqual([id(9), id(8)].map(String));
    expect(ids(after)).toEqual(
      [7, 6, 5, 4, 3, 2, 1].map((n) => id(n).toString()),
    );
    expect(
      ids(
        await read(field, {
          range: { $gte: record(4).createdAt, $lte: record(6).createdAt },
        }),
      ),
    ).toEqual([7, 6, 5, 4].map((n) => id(n).toString()));
  });
});

describe("countSearchMatches", () => {
  beforeEach(async () => {
    for (let n = 1; n <= 9; n += 1) {
      await store.indexRecord(
        source,
        record(n, {
          business: { name: n % 3 === 0 ? "Hilltop Farm" : `Hillside ${n}` },
          parcels: [{ id: `SX${n % 2}` }, { id: `SY${n % 2}` }],
        }),
      );
    }

    await store.indexRecord(
      source,
      record(10, { business: { name: "Hilltop Farm" } }, "grant-b"),
    );
  });

  const count = (field, options = {}) =>
    store.countSearchMatches(source, {
      value: "grant-a",
      field,
      limit: 20,
      maxTimeMS: 5000,
      ...options,
    });

  it("counts an exact value within the lead value", async () => {
    expect(await count({ key: "parcelId", match: "exact", value: "sx1" })).toBe(
      5,
    );
  });

  it("counts each record a prefix matches once, however many of its values match", async () => {
    expect(
      await count({ key: "businessName", match: "prefix", value: "hilltop" }),
    ).toBe(3);
    expect(await count({ key: "parcelId", match: "prefix", value: "s" })).toBe(
      9,
    );
  });

  it("counts within a range, and stops at the limit", async () => {
    const field = { key: "businessName", match: "prefix", value: "hill" };

    expect(
      await count(field, {
        range: { $gte: record(4).createdAt, $lte: record(6).createdAt },
      }),
    ).toBe(4);
    expect(await count(field, { limit: 3 })).toBe(3);
  });
});

describe("SearchReindexer", () => {
  const reindexer = () => {
    const built = new SearchReindexer({ source, intervalMs: 1000 });
    built.running = true;

    return built;
  };

  it("rebuilds every document whose declaration changed, in batches of 200", async () => {
    const records = Array.from({ length: 450 }, (_, n) =>
      record(n + 1, {
        business: { name: `Farm ${n}` },
        parcels: [{ id: "SX1" }],
      }),
    );
    await db.collection("records").insertMany(records);
    listed = [{ value: "grant-a", search: null }];
    for (const each of records) {
      await store.indexRecord(source, each);
    }

    listed = [{ value: "grant-a", search }];
    await reindexer().reindex();

    const docs = await searchDocs();
    expect(docs).toHaveLength(450);
    expect(docs.every(({ sig }) => sig === declarationOf(search).sig)).toBe(
      true,
    );
    expect(docs[0].keys).toEqual(["businessName:farm0", "parcelId:sx1"]);
    expect(logger.info).toHaveBeenCalledWith(
      "Search record_search: rebuilt 450 and removed 0 documents of grant-a",
    );
  });

  it("removes the document of a record that is gone, and leaves current ones alone", async () => {
    await db.collection("records").insertOne(record(1, {}));
    await store.indexRecord(source, record(1, {}));
    await db.collection("record_search").insertOne({
      _id: id(2),
      code: "grant-a",
      createdAt: "x",
      keys: [],
      sig: "old",
    });
    const before = await db.collection("record_search").findOne({ _id: id(1) });

    await reindexer().reindex();

    expect(await searchDocs()).toEqual([before]);
  });

  const staleRecords = async (count) => {
    const records = Array.from({ length: count }, (_, n) =>
      record(n + 1, { business: { name: `Farm ${n}` } }),
    );
    await db.collection("records").insertMany(records);
    await db.collection("record_search").insertMany(
      records.map(({ _id, code, createdAt }) => ({
        _id,
        code,
        createdAt,
        keys: [],
        sig: "old",
        stamp: stampOf(0),
      })),
    );
  };

  it("converges with an instance holding an earlier declaration, and both stop", async () => {
    const older = {
      fields: [{ key: "parcelId", label: "Parcel", path: "$.answers.x" }],
    };
    const behind = reindexerOf(
      sourceListing(async () => [
        { value: "grant-a", search: older, change: EARLIER },
      ]),
    );
    const ahead = reindexerOf(
      sourceListing(async () => [{ value: "grant-a", search, change: LATER }]),
    );
    await staleRecords(600);

    for (let wake = 0; wake < 3; wake += 1) {
      await Promise.all([behind.reindex(), ahead.reindex()]);
    }

    await ahead.reindex();
    await behind.reindex();

    const docs = await searchDocs();
    expect(
      docs.every(
        ({ sig, stamp }) =>
          sig === declarationOf(search).sig &&
          stamp === declarationOf(search, LATER).stamp,
      ),
    ).toBe(true);
  }, 20_000);

  it("ends a wake when its declaration changes between batches", async () => {
    const listing = vi
      .fn()
      .mockResolvedValueOnce([
        { value: "grant-a", search: null, change: EARLIER },
      ])
      .mockResolvedValue([{ value: "grant-a", search, change: LATER }]);
    await staleRecords(450);

    await reindexerOf(sourceListing(listing)).reindex();

    expect(logger.info).toHaveBeenCalledWith(
      "Search record_search: rebuilt 200 and removed 0 documents of grant-a",
    );
    expect(
      await db
        .collection("record_search")
        .countDocuments({ sig: declarationOf(null).sig }),
    ).toBe(200);
  });

  it("rebuilds at most ten batches a wake, leaving the rest to the next", async () => {
    await staleRecords(2100);

    await reindexer().reindex();

    expect(
      await db.collection("record_search").countDocuments({ sig: "old" }),
    ).toBe(100);

    await reindexer().reindex();

    expect(
      await db.collection("record_search").countDocuments({ sig: "old" }),
    ).toBe(0);
  }, 20_000);

  it("stops between batches once stopped", async () => {
    await db.collection("record_search").insertOne({
      _id: id(2),
      code: "grant-a",
      createdAt: "x",
      keys: [],
      sig: "old",
    });
    const stopped = reindexer();
    stopped.running = false;

    await stopped.reindex();

    expect(await searchDocs()).toHaveLength(1);
    expect((await searchDocs())[0].sig).toBe("old");
  });
});

describe("SearchSweeper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sweeper = (batchSize, intervalMs = 0) =>
    new SearchSweeper({ source, batchSize, intervalMs });

  const sweep = () =>
    db.collection("search_sweeps").findOne({ _id: "record_search" });

  const documentOf = (each) => ({
    _id: each._id,
    code: each.code,
    createdAt: each.createdAt,
    keys: [`businessName:${each.answers.business.name.toLowerCase()}`],
    sig: declarationOf(search).sig,
    stamp: declarationOf(search).stamp,
  });

  const records = (count) =>
    Array.from({ length: count }, (_, n) =>
      record(n + 1, { business: { name: `Farm${n + 1}` } }),
    );

  it("creates a missing document, fixes stale keys and removes orphans, leaving current ones alone", async () => {
    const [current, stale, missing] = [
      record(1, { business: { name: "Farm1" } }),
      record(3, { business: { name: "Farm3" } }),
      record(4, { business: { name: "Farm4" } }),
    ];
    await db.collection("records").insertMany([current, stale, missing]);
    await db
      .collection("record_search")
      .insertMany([
        { ...documentOf(current), untouched: true },
        documentOf(record(2, { business: { name: "Farm2" } })),
        { ...documentOf(stale), keys: ["businessName:oldname"] },
        documentOf(record(9, { business: { name: "Farm9" } })),
      ]);

    await sweeper(10).sweepBatch();

    expect(await searchDocs()).toEqual([
      { ...documentOf(current), untouched: true },
      documentOf(stale),
      documentOf(missing),
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      "Search record_search: swept 3 records, fixed 4 documents",
    );
    expect(await sweep()).toEqual({
      _id: "record_search",
      after: null,
      passStartedAt: null,
      lastPassCompletedAt: expect.any(Date),
      lastBatchAt: expect.any(Date),
      checked: 0,
      fixed: 0,
    });
  });

  it("leaves alone a document built from a later declaration, and a record whose grant lists none", async () => {
    const later = {
      ...documentOf(record(1, { business: { name: "Later" } })),
      stamp: declarationOf(search, LATER).stamp,
    };
    await db
      .collection("records")
      .insertMany([
        record(1, { business: { name: "Farm1" } }),
        record(2, { business: { name: "Farm2" } }, "grant-unlisted"),
      ]);
    await db.collection("record_search").insertOne(later);

    await sweeper(10).sweepBatch();

    expect(await searchDocs()).toEqual([later]);
  });

  it("sweeps one batch an interval, however many instances wake", async () => {
    const all = records(6);
    await db.collection("records").insertMany(all);
    const find = Collection.prototype.find;
    const readRecords = vi
      .spyOn(Collection.prototype, "find")
      .mockImplementation(function (...args) {
        return find.apply(this, args);
      });
    const recordReads = () =>
      readRecords.mock.contexts.filter(
        ({ collectionName }) => collectionName === "records",
      ).length;

    try {
      await Promise.all([
        sweeper(2, 60_000).sweepBatch(),
        sweeper(2, 60_000).sweepBatch(),
      ]);
      expect(recordReads()).toBe(1);
      expect(await sweep()).toMatchObject({ after: id(2), checked: 2 });

      await sweeper(2, 60_000).sweepBatch();
      expect(recordReads()).toBe(1);

      await db
        .collection("search_sweeps")
        .updateOne(
          { _id: "record_search" },
          { $set: { lastBatchAt: new Date(Date.now() - 60_000) } },
        );
      await sweeper(2, 60_000).sweepBatch();
      expect(await sweep()).toMatchObject({ after: id(4), checked: 4 });
    } finally {
      readRecords.mockRestore();
    }
  });

  it("logs a pass that found nothing to fix at info", async () => {
    const all = records(2);
    await db.collection("records").insertMany(all);
    await db.collection("record_search").insertMany(all.map(documentOf));

    await sweeper(10).sweepBatch();

    expect(logger.info).toHaveBeenCalledWith(
      "Search record_search: swept 2 records, fixed 0 documents",
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("swept"),
    );
  });

  it("resumes where the last batch stopped, on any instance, and wraps at the end", async () => {
    const all = records(5);
    await db.collection("records").insertMany(all);

    await sweeper(2).sweepBatch();
    expect(await sweep()).toMatchObject({
      after: id(2),
      passStartedAt: expect.any(Date),
      checked: 2,
      fixed: 2,
    });
    expect(await searchDocs()).toEqual(all.slice(0, 2).map(documentOf));

    await sweeper(2).sweepBatch();
    expect(await sweep()).toMatchObject({ after: id(4), checked: 4 });

    await sweeper(2).sweepBatch();
    expect(await sweep()).toMatchObject({
      after: null,
      lastPassCompletedAt: expect.any(Date),
    });
    expect(await searchDocs()).toEqual(all.map(documentOf));
    expect(logger.warn).toHaveBeenCalledWith(
      "Search record_search: swept 5 records, fixed 5 documents",
    );

    await db.collection("record_search").deleteOne({ _id: id(1) });
    await sweeper(2).sweepBatch();
    expect(await searchDocs()).toEqual(all.map(documentOf));
    expect(await sweep()).toMatchObject({ after: id(2), fixed: 1 });
  });

  it("retries a batch whose record was written meanwhile, rather than store its old keys", async () => {
    const before = record(1, { business: { name: "OldFarm" } });
    const after = record(1, { business: { name: "NewFarm" } });
    await db.collection("records").insertOne(before);
    const bulkWrite = Collection.prototype.bulkWrite;
    let interleaved = 0;
    const written = vi
      .spyOn(Collection.prototype, "bulkWrite")
      .mockImplementationOnce(async function (...args) {
        await db.collection("records").replaceOne({ _id: after._id }, after);
        await store.indexRecord(source, after);
        interleaved += 1;

        return bulkWrite.apply(this, args);
      });

    try {
      await sweeper(10).sweepBatch();
    } finally {
      written.mockRestore();
    }

    expect(interleaved).toBe(1);
    expect(await searchDocs()).toEqual([documentOf(after)]);
  });
});

describe("findCurrentSearches", () => {
  const configVersion = (grantCode, version, status) => {
    const [major, minor, patch] = version.split(".").map(Number);

    return { grantCode, version, major, minor, patch, status };
  };

  const older = {
    fields: [{ key: "parcelId", label: "Parcel", path: "$.answers.x" }],
  };

  const currentOf = async (code) =>
    (await findCurrentSearches(db, "definitions")).find(
      ({ value }) => value === code,
    );

  beforeEach(async () => {
    await db
      .collection("config_versions")
      .insertMany([
        configVersion("grant-a", "1.9.0", "active"),
        configVersion("grant-a", "1.10.0", "active"),
        configVersion("grant-a", "2.0.0", "draft"),
        configVersion("grant-b", "1.0.0", "active"),
        configVersion("grant-c", "1.1.0", "active"),
      ]);
    await db.collection("definitions").insertMany([
      { code: "grant-a", version: "1.9.0", search: older },
      { code: "grant-a", version: "1.10.0", search },
      { code: "grant-a", version: "2.0.0", search: null },
      { code: "grant-b", version: "1.0.0" },
      { code: "grant-c", version: "1.0.0", search },
    ]);
    for (const code of ["grant-a", "grant-a", "grant-a", "grant-b"]) {
      await recordConfigChange(db, code);
    }
  });

  it("answers each code's highest active version's search, with its count of config changes", async () => {
    expect(await findCurrentSearches(db, "definitions")).toEqual(
      expect.arrayContaining([
        { value: "grant-a", search, change: 3 },
        { value: "grant-b", search: null, change: 1 },
      ]),
    );
    expect(await findCurrentSearches(db, "definitions")).toHaveLength(2);
  });

  it("moves on, later, when the current version is withdrawn back to an earlier one", async () => {
    const before = declarationOf(search, (await currentOf("grant-a")).change);
    await db
      .collection("config_versions")
      .updateOne(
        { grantCode: "grant-a", version: "1.10.0" },
        { $set: { status: "draft" } },
      );
    await recordConfigChange(db, "grant-a");

    const current = await currentOf("grant-a");

    expect(current).toEqual({ value: "grant-a", search: older, change: 4 });
    expect(declarationOf(older, current.change).stamp > before.stamp).toBe(
      true,
    );
  });

  it("orders two changes in quick succession by when they committed", async () => {
    const stamps = [];

    for (const status of ["draft", "active"]) {
      await db
        .collection("config_versions")
        .updateOne(
          { grantCode: "grant-a", version: "1.10.0" },
          { $set: { status } },
        );
      await recordConfigChange(db, "grant-a");
      const { search: declared, change } = await currentOf("grant-a");
      stamps.push(declarationOf(declared, change));
    }

    expect(stamps.map(({ fields }) => fields)).toEqual([
      declarationOf(older).fields,
      declarationOf(search).fields,
    ]);
    expect(stamps[1].stamp > stamps[0].stamp).toBe(true);
  });

  it("stays on the highest active version stored while a later one is not, fetched or failed", async () => {
    await db
      .collection("config_versions")
      .insertMany([
        configVersion("grant-a", "1.11.0", "active"),
        configVersion("grant-a", "1.12.0", "active"),
      ]);

    expect(await currentOf("grant-a")).toEqual({
      value: "grant-a",
      search,
      change: 3,
    });
  });

  it("answers nothing without config versions", async () => {
    await db.collection("config_versions").deleteMany({});

    expect(await findCurrentSearches(db, "definitions")).toEqual([]);
  });
});
