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
import { up as reissueAccessTokens } from "../../migrations/20261104125000-reissue-access-tokens-without-object-id.js";
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
  db = client.db("reissue-access-tokens-without-object-id");
  accessTokens = db.collection("access_tokens");
  await accessTokens.createIndex({ id: 1 }, { unique: true });
}, 120_000);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  await accessTokens.deleteMany({});
  vi.mocked(logger.info).mockClear();
});

const HASH = "a".repeat(63) + "1";
const OTHER_HASH = "a".repeat(63) + "2";
const CREATED = new Date("2026-11-02T10:00:00.000Z");

describe("moving access tokens to an ObjectId", () => {
  it("moves a row with a string _id to a new ObjectId, keeping every field", async () => {
    await accessTokens.insertOne({
      _id: "hand-made",
      id: HASH,
      clientId: "grants-ui",
      expiresAt: null,
      createdAt: CREATED,
    });

    await reissueAccessTokens(db, client);

    const rows = await accessTokens.find({}).toArray();
    expect(rows).toEqual([
      {
        _id: expect.any(ObjectId),
        id: HASH,
        clientId: "grants-ui",
        expiresAt: null,
        createdAt: CREATED,
      },
    ]);
  });

  it("gives a moved row with no createdAt a null one, never the new id's", async () => {
    await accessTokens.insertOne({ _id: 7, id: HASH, clientId: "grants-ui" });

    await reissueAccessTokens(db, client);

    expect(await accessTokens.findOne({ id: HASH })).toMatchObject({
      _id: expect.any(ObjectId),
      createdAt: null,
    });
  });

  it("leaves a row with an ObjectId alone, and logs only the count", async () => {
    const _id = new ObjectId();
    await accessTokens.insertMany([
      { _id, id: HASH, clientId: "grants-ui" },
      { _id: "hand-made", id: OTHER_HASH, clientId: "grants-ui" },
    ]);

    await reissueAccessTokens(db, client);

    expect(await accessTokens.findOne({ _id })).toEqual({
      _id,
      id: HASH,
      clientId: "grants-ui",
    });
    expect(await accessTokens.countDocuments({ _id: "hand-made" })).toBe(0);
    expect(logger.info).toHaveBeenCalledWith(
      "Moved 1 access tokens to an ObjectId",
    );
  });

  it("changes nothing when run again", async () => {
    await accessTokens.insertOne({ _id: "hand-made", id: HASH });
    await reissueAccessTokens(db, client);
    const first = await accessTokens.find({}).toArray();

    await reissueAccessTokens(db, client);

    expect(await accessTokens.find({}).toArray()).toEqual(first);
    expect(logger.info).toHaveBeenLastCalledWith(
      "Moved 0 access tokens to an ObjectId",
    );
  });
});
