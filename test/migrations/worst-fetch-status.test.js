import { Collection, MongoClient } from "mongodb";
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
import { up as stampWorstFetchStatus } from "../../migrations/20261025110000-stamp-worst-fetch-status.js";

vi.mock("../../src/common/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let replSet;
let client;
let db;
let configVersions;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = await MongoClient.connect(replSet.getUri());
  db = client.db("worst-fetch-status-migration");
  configVersions = db.collection("config_versions");
}, 120_000);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  await db.dropDatabase();
});

const aVersion = (version, definitions) => ({
  grantCode: "woodland",
  version,
  status: "active",
  receivedAt: "2026-10-01T10:00:00.000Z",
  definitions,
});

const file = (fetchStatus) => ({ s3Key: "key.json", fetchStatus });

const worstByVersion = async () =>
  Object.fromEntries(
    (await configVersions.find().toArray()).map((row) => [
      row.version,
      row.worstFetchStatus,
    ]),
  );

const keysOf = async () =>
  (await configVersions.indexes()).map(({ key }) => Object.keys(key).join(","));

describe("stamp worst fetch status", () => {
  it("stamps every version with the worst fetch status of its files", async () => {
    await configVersions.insertMany([
      aVersion("1.0.0", { grant: file("fetched") }),
      aVersion("1.1.0", {
        grant: file("fetched"),
        agreement: file("pending"),
      }),
      aVersion("1.2.0", {
        grant: file("fetched"),
        agreement: file("transient_error"),
        payment: file("pending"),
      }),
      aVersion("1.3.0", {
        grant: file("pending"),
        payment: file("permanent_error"),
      }),
    ]);

    await stampWorstFetchStatus(db);

    expect(await worstByVersion()).toEqual({
      "1.0.0": "fetched",
      "1.1.0": "pending",
      "1.2.0": "transient_error",
      "1.3.0": "permanent_error",
    });
  });

  it("drops the indexes on the grant file's fetch status and builds the bucket's", async () => {
    await configVersions.insertOne(
      aVersion("1.0.0", { grant: file("fetched") }),
    );
    await configVersions.createIndex({
      grantCode: 1,
      status: 1,
      "definitions.grant.fetchStatus": 1,
      receivedAt: -1,
      _id: -1,
    });
    await configVersions.createIndex({
      status: 1,
      "definitions.grant.fetchStatus": 1,
      receivedAt: -1,
      _id: -1,
    });

    await stampWorstFetchStatus(db);

    expect(await keysOf()).toEqual([
      "_id",
      "receivedAt,_id",
      "grantCode,status,worstFetchStatus,receivedAt,_id",
      "status,worstFetchStatus,receivedAt,_id",
      "refs,receivedAt,_id",
    ]);
  });

  it("runs on a database with no config versions", async () => {
    await stampWorstFetchStatus(db);

    expect(await keysOf()).toContain("status,worstFetchStatus,receivedAt,_id");
  });

  it("changes nothing the second time", async () => {
    await configVersions.insertOne(
      aVersion("1.0.0", { grant: file("fetched"), agreement: file("pending") }),
    );
    await stampWorstFetchStatus(db);
    const rows = await configVersions.find().toArray();
    const keys = await keysOf();

    await stampWorstFetchStatus(db);

    expect(await configVersions.find().toArray()).toEqual(rows);
    expect(await keysOf()).toEqual(keys);
  });

  it.each([
    [
      "an unknown fetch status",
      { grant: file("fetched"), payment: file("lost") },
    ],
    ["a file with no fetch status", { grant: { s3Key: "key.json" } }],
    ["no grant file", { agreement: file("fetched") }],
    ["no files", {}],
  ])(
    "refuses to start, naming the version, on a version with %s",
    async (_, definitions) => {
      await configVersions.insertMany([
        aVersion("1.0.0", { grant: file("fetched") }),
        aVersion("2.0.0", definitions),
      ]);

      await expect(stampWorstFetchStatus(db)).rejects.toThrow(
        "Config versions with no grant file or a fetch status GAS does not know: woodland@2.0.0",
      );
      expect(
        await configVersions.countDocuments({
          worstFetchStatus: { $exists: true },
        }),
      ).toBe(0);
    },
  );

  it("fails when a version it should have stamped is left without one", async () => {
    await configVersions.insertOne(
      aVersion("1.0.0", { grant: file("fetched") }),
    );
    vi.spyOn(Collection.prototype, "updateMany").mockResolvedValue({
      modifiedCount: 0,
    });

    await expect(stampWorstFetchStatus(db)).rejects.toThrow(
      "Config versions left without a worst fetch status: woodland@1.0.0",
    );
  });
});
