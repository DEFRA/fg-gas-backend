import { MongoClient } from "mongodb";
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
import { up as uniqueSeededClient } from "../../migrations/20260825090000-unique-seeded-access-token-per-client.js";
import { up as removeSeeded } from "../../migrations/20261104120000-remove-seeded-access-tokens.js";
import { AccessToken } from "../../src/auth/models/access-token.js";

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
  db = client.db("remove-seeded-access-tokens");
  accessTokens = db.collection("access_tokens");
}, 120_000);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  await accessTokens.drop().catch(() => {});
});

const indexNames = async () =>
  (await accessTokens.indexes()).map(({ name }) => name);

describe("removing seeded from access tokens", () => {
  it("drops both seeded indexes and unsets seeded, leaving the rows", async () => {
    await accessTokens.insertMany([
      { id: "a".repeat(64), client: "alpha", clientId: "alpha", seeded: true },
      { id: "b".repeat(64), client: "beta", clientId: "beta" },
    ]);
    await uniqueSeededClient(db);
    await accessTokens.createIndex(
      { clientId: 1, seeded: 1 },
      {
        unique: true,
        partialFilterExpression: { seeded: true },
        name: "seeded_client_id_unique",
      },
    );

    await removeSeeded(db);

    expect(await indexNames()).not.toEqual(
      expect.arrayContaining(["seeded_client_unique"]),
    );
    expect(await indexNames()).not.toContain("seeded_client_id_unique");
    expect(
      await accessTokens.countDocuments({ seeded: { $exists: true } }),
    ).toBe(0);
    expect(await accessTokens.countDocuments()).toBe(2);
  });

  it("runs on a database where neither index was made", async () => {
    await accessTokens.insertOne({ id: "c".repeat(64), clientId: "gamma" });

    await expect(removeSeeded(db)).resolves.toBeUndefined();
  });

  it("runs before access_tokens exists", async () => {
    await expect(removeSeeded(db)).resolves.toBeUndefined();
  });

  // Auth reads the hash and the expiry, and neither is touched.
  it("leaves every row authenticating", async () => {
    await accessTokens.insertMany([
      { id: "a".repeat(64), clientId: "alpha", expiresAt: null, seeded: true },
      { id: "b".repeat(64), clientId: "beta", expiresAt: null },
    ]);
    await uniqueSeededClient(db);

    await removeSeeded(db);

    const rows = await accessTokens.find({}).toArray();
    expect(rows.map(({ id }) => id).sort()).toEqual([
      "a".repeat(64),
      "b".repeat(64),
    ]);
    expect(
      rows.every((row) => AccessToken.fromDocument(row).isActive(new Date())),
    ).toBe(true);
  });
});
