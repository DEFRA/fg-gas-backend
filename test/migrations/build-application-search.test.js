import { Collection, MongoClient, ObjectId } from "mongodb";
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
import { up as buildApplicationSearch } from "../../migrations/20261111120000-build-application-search.js";
import { logger } from "../../src/common/logger.js";
import {
  NO_DECLARATION,
  declarationOf,
} from "../../src/common/search/declarations.js";

vi.mock("../../src/common/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const search = {
  fields: [
    {
      key: "businessName",
      label: "Business name",
      path: "$.answers.business.name",
      match: "prefix",
    },
    { key: "parcelId", label: "Parcel ID", path: "$.answers.parcels[*].id" },
  ],
};

const id = (n) =>
  ObjectId.createFromHexString(n.toString(16).padStart(24, "0"));

const application = (n, code, phases) => ({
  _id: id(n),
  clientRef: `ref-${n}`,
  code,
  createdAt: `2026-09-01T10:00:0${n % 10}.000Z`,
  phases,
});

let replSet;
let client;
let db;

const searchDocs = () =>
  db
    .collection("application_search")
    .find({}, { sort: { _id: 1 } })
    .toArray();

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = await MongoClient.connect(replSet.getUri());
  db = client.db("build-application-search-migration");
}, 120_000);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
});

const configVersion = (grantCode, version, status) => {
  const [major, minor, patch] = version.split(".").map(Number);

  return {
    grantCode,
    version,
    major,
    minor,
    patch,
    status,
  };
};

beforeEach(async () => {
  await db.dropDatabase();
  await db
    .collection("config_versions")
    .insertMany([
      configVersion("grant-a", "1.2.0", "active"),
      configVersion("grant-a", "1.10.0", "active"),
      configVersion("grant-a", "2.0.0", "draft"),
      configVersion("grant-b", "1.0.0", "active"),
      configVersion("grant-c", "1.0.0", "active"),
      configVersion("grant-c", "1.1.0", "active"),
    ]);
  await db.collection("grants").insertMany([
    { code: "grant-a", version: "1.2.0", search: null },
    { code: "grant-a", version: "1.10.0", search },
    {
      code: "grant-a",
      version: "2.0.0",
      search: {
        fields: [{ key: "draft", label: "Draft", path: "$.answers.draft" }],
      },
    },
    { code: "grant-b", version: "1.0.0", search: null },
    { code: "grant-c", version: "1.0.0", search },
  ]);
  await db
    .collection("config_changes")
    .insertOne({ _id: "grant-a", change: 3 });
});

describe("build application search", () => {
  it("creates the search and reindexer indexes", async () => {
    await buildApplicationSearch(db);

    const indexes = await db.collection("application_search").indexes();

    expect(indexes.map(({ key }) => key)).toEqual([
      { _id: 1 },
      { code: 1, keys: 1, createdAt: -1, _id: -1 },
      { code: 1, sig: 1, stamp: 1 },
    ]);
  });

  it("gives every application a document from its grant's current declaration", async () => {
    await db.collection("applications").insertMany([
      application(1, "grant-a", [
        { code: "PRE_AWARD", answers: { business: { name: "Hilltop Farm" } } },
        {
          code: "POST_AGREEMENT",
          answers: { parcels: [{ id: "SX1" }, { id: "SX 2" }] },
        },
      ]),
      application(2, "grant-b", [
        { code: "PRE_AWARD", answers: { business: { name: "Valley" } } },
      ]),
      application(3, "grant-unpublished", []),
      application(4, "grant-a", undefined),
      application(5, "grant-c", [
        { code: "PRE_AWARD", answers: { business: { name: "Hilltop Farm" } } },
      ]),
    ]);

    await buildApplicationSearch(db);

    expect(await searchDocs()).toEqual([
      {
        _id: id(1),
        code: "grant-a",
        createdAt: "2026-09-01T10:00:01.000Z",
        keys: ["businessName:hilltopfarm", "parcelId:sx1", "parcelId:sx2"],
        sig: declarationOf(search).sig,
        stamp: declarationOf(search, 3).stamp,
      },
      {
        _id: id(2),
        code: "grant-b",
        createdAt: "2026-09-01T10:00:02.000Z",
        keys: [],
        sig: declarationOf(null).sig,
        stamp: declarationOf(null, 0).stamp,
      },
      expect.objectContaining({
        _id: id(3),
        keys: [],
        sig: NO_DECLARATION.sig,
        stamp: NO_DECLARATION.stamp,
      }),
      expect.objectContaining({
        _id: id(4),
        keys: [],
        sig: declarationOf(search).sig,
      }),
      expect.objectContaining({
        _id: id(5),
        keys: ["businessName:hilltopfarm"],
        sig: declarationOf(search).sig,
      }),
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      "Gave 5 applications their search documents, 3 of them with no keys",
    );
  });

  it("stamps each document with its algorithm and its grant's count of config changes", async () => {
    await db
      .collection("applications")
      .insertMany([
        application(1, "grant-a", []),
        application(2, "grant-b", []),
      ]);

    await buildApplicationSearch(db);

    expect((await searchDocs()).map(({ stamp }) => stamp)).toEqual([
      "0003:000000000003",
      "0003:000000000000",
    ]);
  });

  it("logs the counts, and does not fail, when an older instance inserts an application meanwhile", async () => {
    await db
      .collection("applications")
      .insertOne(application(1, "grant-a", []));
    const bulkWrite = Collection.prototype.bulkWrite;
    const written = vi
      .spyOn(Collection.prototype, "bulkWrite")
      .mockImplementationOnce(async function (...args) {
        await db
          .collection("applications")
          .insertOne(application(2, "grant-a", []));

        return bulkWrite.apply(this, args);
      });

    try {
      await buildApplicationSearch(db);
    } finally {
      written.mockRestore();
    }

    expect(logger.info).toHaveBeenCalledWith(
      "Search application_search: 1 documents for 2 applications",
    );
  });

  it("counts what it could not index, never the values, and still writes the document", async () => {
    await db.collection("applications").insertOne(
      application(1, "grant-a", [
        {
          code: "PRE_AWARD",
          answers: {
            business: { name: { text: "Hidden Value" } },
            parcels: [{ id: "SX1" }, { id: true }],
          },
        },
      ]),
    );

    await buildApplicationSearch(db);

    expect((await searchDocs())[0].keys).toEqual(["parcelId:sx1"]);
    expect(logger.warn).toHaveBeenCalledWith(
      "Search application_search: values not indexed on 1 records: businessName (1 not text, 0 over the caps), parcelId (1 not text, 0 over the caps)",
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(/hidden/i);
  });

  it("replaces a document already written, so it can run again", async () => {
    await db
      .collection("applications")
      .insertOne(
        application(1, "grant-a", [
          { code: "PRE_AWARD", answers: { business: { name: "Hilltop" } } },
        ]),
      );
    await db.collection("application_search").insertOne({
      _id: id(1),
      code: "grant-a",
      keys: ["businessName:old"],
      sig: "x",
    });

    await buildApplicationSearch(db);
    await buildApplicationSearch(db);

    expect(await searchDocs()).toEqual([
      expect.objectContaining({ keys: ["businessName:hilltop"] }),
    ]);
  });
});
