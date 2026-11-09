import { MongoClient, ObjectId } from "mongodb";
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
import { up as datedAccessTokens } from "../../migrations/20261104140000-backfill-access-token-created-at.js";
import { logger } from "../../src/common/logger.js";

vi.mock("../../src/common/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let replSet;
let client;
let db;
let accessTokens;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = await MongoClient.connect(replSet.getUri());
  db = client.db("backfill-access-token-created-at");
  accessTokens = db.collection("access_tokens");
}, 120_000);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  await accessTokens.deleteMany({});
  vi.mocked(logger.info).mockClear();
});

const SEEDED = new ObjectId("6650c1f2a9e4b1d07c20bd91");
const CREATED = new Date("2026-11-02T10:00:00.000Z");

describe("dating access tokens from their ids", () => {
  it("sets createdAt from the ObjectId's timestamp, and no createdBy", async () => {
    await accessTokens.insertOne({ _id: SEEDED, clientId: "grants-ui" });

    await datedAccessTokens(db);

    const row = await accessTokens.findOne({ _id: SEEDED });
    expect(row.createdAt).toEqual(SEEDED.getTimestamp());
    expect(row).not.toHaveProperty("createdBy");
  });

  it("leaves a row that already has createdAt alone", async () => {
    await accessTokens.insertOne({
      _id: SEEDED,
      clientId: "grants-ui",
      createdAt: CREATED,
    });

    await datedAccessTokens(db);

    expect((await accessTokens.findOne({ _id: SEEDED })).createdAt).toEqual(
      CREATED,
    );
  });

  it("changes nothing when run again", async () => {
    await accessTokens.insertMany([
      { _id: SEEDED, clientId: "grants-ui" },
      { _id: new ObjectId(), clientId: "grants-ui", createdAt: CREATED },
    ]);
    await datedAccessTokens(db);
    const first = await accessTokens.find({}).toArray();

    await datedAccessTokens(db);

    expect(await accessTokens.find({}).toArray()).toEqual(first);
    expect(logger.info).toHaveBeenLastCalledWith(
      "Dated 0 access tokens from their ids",
    );
  });
});
