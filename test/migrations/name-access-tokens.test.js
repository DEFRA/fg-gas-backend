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
import {
  normaliseName,
  up as nameAccessTokens,
} from "../../migrations/20261104130000-name-access-tokens.js";
import { countIdentityShapes } from "../../src/auth/access-token-identity.js";
import { AccessToken } from "../../src/auth/models/access-token.js";
import { logger } from "../../src/common/logger.js";

vi.mock("../../src/common/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const ADMIN = "fg-grants-platform-admin";

let replSet;
let client;
let db;
let accessTokens;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = await MongoClient.connect(replSet.getUri());
  db = client.db("name-access-tokens");
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

let counter = 0;
const hash = () => (++counter).toString(16).padStart(64, "0");

const insert = async (fields) => {
  const _id = new ObjectId();
  await accessTokens.insertOne({ _id, id: hash(), expiresAt: null, ...fields });
  return _id;
};

const namesOf = async (_id) =>
  accessTokens.findOne(
    { _id },
    { projection: { _id: 0, clientId: 1, client: 1 } },
  );

const unnamedFor = (_id) => `unnamed-${_id.toHexString().slice(-6)}`;

describe("normaliseName", () => {
  it.each([
    ["Grants_UI", "grants-ui"],
    ["  Grants  UI  ", "grants-ui"],
    ["grants__--ui", "grants-ui"],
    ["-grants-ui-", "grants-ui"],
    ["Grants.UI/v2", "grants-ui-v2"],
    ["___", ""],
    [`${"a".repeat(63)}_b`, "a".repeat(63)],
    ["a".repeat(70), "a".repeat(64)],
  ])("normalises %o to %o", (name, normalised) => {
    expect(normaliseName(name)).toBe(normalised);
  });
});

describe("naming access tokens", () => {
  it("normalises an invalid name, setting clientId and client", async () => {
    const _id = await insert({ clientId: "Grants_UI", client: "Grants_UI" });

    await nameAccessTokens(db);

    expect(await namesOf(_id)).toEqual({
      clientId: "grants-ui",
      client: "grants-ui",
    });
  });

  it.each([
    ["no clientId", {}],
    ["a null clientId", { clientId: null }],
    ["a blank clientId", { clientId: "   " }],
    ["a clientId that is not a string", { clientId: 42 }],
    ["a name that normalises to nothing", { clientId: "___" }],
    [
      "a name that normalises to 64 hex characters",
      { clientId: "A".repeat(64) },
    ],
  ])("names a row with %s after its id", async (_, fields) => {
    const _id = await insert(fields);

    await nameAccessTokens(db);

    expect(await namesOf(_id)).toEqual({
      clientId: unnamedFor(_id),
      client: unnamedFor(_id),
    });
  });

  // An ObjectId starts with its creation second, so only its end tells apart
  // rows made together.
  it("names two rows made in the same second differently", async () => {
    const first = new ObjectId("6650c1f2a9e4b1d07c000001");
    const second = new ObjectId("6650c1f2a9e4b1d07c000002");
    await accessTokens.insertMany([
      { _id: first, id: hash() },
      { _id: second, id: hash() },
    ]);

    await nameAccessTokens(db);

    expect((await namesOf(first)).clientId).toBe("unnamed-000001");
    expect((await namesOf(second)).clientId).toBe("unnamed-000002");
  });

  // FGP-1534's "admin client only" shape: it has never passed the guard.
  it("never names a row with only the admin's legacy client as the admin", async () => {
    const _id = await insert({ client: ADMIN });

    await nameAccessTokens(db);

    expect((await namesOf(_id)).clientId).toBe(unnamedFor(_id));
  });

  it.each([
    ["FG_Grants_Platform_Admin"],
    ["FG-GRANTS-PLATFORM-ADMIN"],
    [" fg grants platform admin "],
    ["FG_GAS_BACKEND"],
    ["fg gas backend"],
  ])("never normalises %o into a platform client's name", async (clientId) => {
    const _id = await insert({ clientId });

    await nameAccessTokens(db);

    expect((await namesOf(_id)).clientId).toBe(unnamedFor(_id));
  });

  it("leaves valid names, the admin's own tokens and other fields alone", async () => {
    const admin = await insert({ clientId: ADMIN, client: ADMIN });
    const conflicting = await insert({
      clientId: "grants-ui",
      client: "legacy",
    });

    await nameAccessTokens(db);

    expect(await namesOf(admin)).toEqual({ clientId: ADMIN, client: ADMIN });
    expect(await namesOf(conflicting)).toEqual({
      clientId: "grants-ui",
      client: "legacy",
    });
  });

  it("changes nothing when run again", async () => {
    await insert({ clientId: "Grants_UI" });
    await insert({ client: ADMIN });
    await nameAccessTokens(db);
    const first = await accessTokens.find({}).toArray();

    await nameAccessTokens(db);

    expect(await accessTokens.find({}).toArray()).toEqual(first);
    expect(logger.info).toHaveBeenLastCalledWith(
      "Named 0 nameless access tokens, normalised 0 names",
    );
  });

  // FGP-1534 PR #823 may already have deleted the admin-only rows.
  it("runs with no admin-only rows, and on an empty collection", async () => {
    await expect(nameAccessTokens(db)).resolves.toBeUndefined();
    await insert({ clientId: "Grants_UI" });
    await expect(nameAccessTokens(db)).resolves.toBeUndefined();
  });

  it("logs counts, never ids, names or hashes", async () => {
    const _id = await insert({ clientId: "Grants_UI" });
    await insert({ client: ADMIN });

    await nameAccessTokens(db);

    const logged = JSON.stringify(vi.mocked(logger.info).mock.calls);
    expect(logged).toContain(
      "Named 1 nameless access tokens, normalised 1 names",
    );
    expect(logged).not.toMatch(/grants|unnamed|[0-9a-f]{24}/);
    expect(logged).not.toContain(_id.toHexString());
  });

  it("counts a name of 64 hex characters as invalid, as Grant Admin does", async () => {
    await insert({ clientId: "a".repeat(64) });

    expect(await countIdentityShapes(accessTokens)).toMatchObject({
      unnamed: 1,
    });
  });

  // Auth reads the hash and the expiry, and neither is touched.
  it("leaves every row authenticating, and none conflicting", async () => {
    await insert({ clientId: "Grants_UI", client: "Grants_UI" });
    await insert({ client: ADMIN });
    await insert({ clientId: "   ", client: "legacy-ui" });
    await insert({ clientId: ADMIN, client: ADMIN });
    const before = await accessTokens
      .find({}, { projection: { id: 1, expiresAt: 1 } })
      .toArray();

    await nameAccessTokens(db);

    const after = await accessTokens.find({}).toArray();
    expect(
      after.map(({ _id, id, expiresAt }) => ({ _id, id, expiresAt })),
    ).toEqual(before);
    expect(
      after.every((row) => AccessToken.fromDocument(row).isActive(new Date())),
    ).toBe(true);
    expect(await countIdentityShapes(accessTokens)).toMatchObject({
      conflicting: 0,
      unnamed: 0,
    });
  });
});
