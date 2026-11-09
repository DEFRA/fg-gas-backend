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
import { up as init } from "../../migrations/20251114120000-init.js";
import { up as removeClient } from "../../migrations/20261109120000-remove-access-token-client.js";
import { countIdentityShapes } from "../../src/auth/access-token-identity.js";
import { AccessToken } from "../../src/auth/models/access-token.js";
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
  db = client.db("remove-access-token-client");
  accessTokens = db.collection("access_tokens");
}, 120_000);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  await accessTokens.drop().catch(() => {});
  vi.mocked(logger.info).mockClear();
});

let counter = 0;
const hash = () => (++counter).toString(16).padStart(64, "0");

const insert = async (fields) => {
  const id = hash();
  await accessTokens.insertOne({ id, expiresAt: null, ...fields });
  return id;
};

const stored = (id) => accessTokens.findOne({ id }, { projection: { _id: 0 } });

const indexNames = async () =>
  (await accessTokens.indexes()).map(({ name }) => name);

describe("removing client from access tokens", () => {
  it("unsets client where clientId names the service and keeps the rest", async () => {
    const createdAt = new Date("2026-11-01T00:00:00.000Z");
    const id = await insert({
      client: "grants-ui",
      clientId: "grants-ui",
      createdAt,
    });

    await removeClient(db);

    expect(await stored(id)).toEqual({
      id,
      clientId: "grants-ui",
      expiresAt: null,
      createdAt,
    });
  });

  it.each([
    ["missing", {}],
    ["blank", { clientId: "  " }],
    ["null", { clientId: null }],
    ["not a string", { clientId: 42 }],
  ])("keeps client when clientId is %s", async (_, fields) => {
    const id = await insert({ client: "legacy-ui", ...fields });

    await removeClient(db);

    expect((await stored(id)).client).toBe("legacy-ui");
  });

  it("drops the client index", async () => {
    await init(db);
    expect(await indexNames()).toContain("client_1");

    await removeClient(db);

    expect(await indexNames()).not.toContain("client_1");
  });

  it("runs on a database where the client index was never made", async () => {
    await insert({ clientId: "grants-ui" });

    await expect(removeClient(db)).resolves.toBeUndefined();
  });

  it("runs before access_tokens exists", async () => {
    await expect(removeClient(db)).resolves.toBeUndefined();
  });

  it("changes nothing when run again", async () => {
    await insert({ client: "grants-ui", clientId: "grants-ui" });
    await removeClient(db);
    const before = await accessTokens.find({}).toArray();

    await removeClient(db);

    expect(await accessTokens.find({}).toArray()).toEqual(before);
    expect(logger.info).toHaveBeenLastCalledWith(
      "Removed client from 0 access tokens",
    );
  });

  it("logs only the count", async () => {
    await insert({ client: "grants-ui", clientId: "grants-ui" });
    await insert({ client: "other-ui", clientId: "other-ui" });

    await removeClient(db);

    const logged = JSON.stringify(vi.mocked(logger.info).mock.calls);
    expect(logged).toContain("Removed client from 2 access tokens");
    expect(logged).not.toMatch(/grants-ui|other-ui|[0-9a-f]{64}/);
  });

  // Auth reads the hash, clientId and the expiry, and none is touched.
  it("leaves every row authenticating as the same service", async () => {
    await insert({ client: "grants-ui", clientId: "grants-ui" });
    await insert({
      client: "fg-grants-platform-admin",
      clientId: "fg-grants-platform-admin",
    });
    const before = await accessTokens
      .find({}, { projection: { id: 1, clientId: 1, expiresAt: 1 } })
      .toArray();

    await removeClient(db);

    const after = await accessTokens.find({}).toArray();
    expect(
      after.map(({ _id, id, clientId, expiresAt }) => ({
        _id,
        id,
        clientId,
        expiresAt,
      })),
    ).toEqual(before);
    expect(
      after.every((row) => AccessToken.fromDocument(row).isActive(new Date())),
    ).toBe(true);
    expect(await countIdentityShapes(accessTokens)).toEqual({
      named: 2,
      unnamed: 0,
      nonDateExpiries: 0,
    });
  });
});
