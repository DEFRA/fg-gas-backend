import { Decimal128, MongoClient, ObjectId } from "mongodb";
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
import { up as normaliseDates } from "../../migrations/20261104115000-normalise-access-token-dates.js";
import { up as reissueAccessTokens } from "../../migrations/20261104125000-reissue-access-tokens-without-object-id.js";
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
  db = client.db("normalise-access-token-dates");
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

const insert = async (fields) => {
  const _id = new ObjectId();
  await accessTokens.insertOne({ _id, clientId: "grants-ui", ...fields });
  return _id;
};

const rowOf = (_id) => accessTokens.findOne({ _id });

const expiryOf = async (_id) => (await rowOf(_id)).expiresAt;

const isActive = async (_id) =>
  AccessToken.fromDocument(await rowOf(_id)).isActive(new Date());

const FUTURE = new Date("2099-01-01T00:00:00.000Z");
const PAST = new Date("2020-01-01T00:00:00.000Z");
const BEFORE_1970 = new Date("1969-12-31T23:59:59.999Z");
const AFTER_9999 = new Date("+010000-01-01T00:00:00.000Z");

describe("normalising access token dates", () => {
  it.each([
    ["a future epoch number", FUTURE, (date) => date.getTime()],
    ["a past epoch number", PAST, (date) => date.getTime()],
    ["a future numeric string", FUTURE, (date) => String(date.getTime())],
    ["a past numeric string", PAST, (date) => String(date.getTime())],
    ["an array holding a future number", FUTURE, (date) => [date.getTime()]],
    [
      "a future decimal",
      FUTURE,
      (date) => Decimal128.fromString(String(date.getTime())),
    ],
  ])("turns %s into its date", async (_, date, stored) => {
    const _id = await insert({ expiresAt: stored(date) });
    const wasActive = await isActive(_id);

    await normaliseDates(db);

    expect(await expiryOf(_id)).toEqual(date);
    expect(await isActive(_id)).toBe(wasActive);
  });

  it.each([
    ["zero", 0],
    ["a number past year 9999", Date.UTC(10000, 0, 1)],
    ["the largest safe integer", Number.MAX_SAFE_INTEGER],
    ["a word", "never"],
    ["a date as a string", "2020-01-01T00:00:00.000Z"],
    ["false", false],
    ["an object", { at: "never" }],
    ["an array holding a date", [FUTURE]],
    ["a date past year 9999", AFTER_9999],
  ])("sets %s, which auth never expires, to never", async (_, expiresAt) => {
    const _id = await insert({ expiresAt });
    expect(await isActive(_id)).toBe(true);

    await normaliseDates(db);

    expect(await expiryOf(_id)).toBeNull();
    expect(await isActive(_id)).toBe(true);
  });

  it.each([
    ["a negative number", -1],
    ["true", true],
    ["an array holding null", [null]],
    ["an empty array", []],
    ["a date before 1970", BEFORE_1970],
  ])(
    "expires %s, which auth already refuses, as of now",
    async (_, expiresAt) => {
      const _id = await insert({ expiresAt });
      expect(await isActive(_id)).toBe(false);
      const before = new Date();

      await normaliseDates(db);

      const expiry = await expiryOf(_id);

      expect(expiry).toBeInstanceOf(Date);
      expect(expiry.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(await isActive(_id)).toBe(false);
    },
  );

  it("expires a revoked token as of now, whatever its expiry held", async () => {
    const _id = await insert({ expiresAt: "never", revokedAt: PAST });

    await normaliseDates(db);

    expect(await expiryOf(_id)).toBeInstanceOf(Date);
    expect(await isActive(_id)).toBe(false);
  });

  it.each([
    ["a date before 1970", BEFORE_1970],
    ["a date past year 9999", AFTER_9999],
    ["a word", "yes"],
    ["true", true],
    ["an array holding null", [null]],
    ["an empty array", []],
  ])(
    "keeps a token revoked whose revokedAt is %s, revoked as of now",
    async (_, revokedAt) => {
      const _id = await insert({ expiresAt: FUTURE, revokedAt });
      expect(await isActive(_id)).toBe(false);
      const before = new Date();

      await normaliseDates(db);

      const row = await rowOf(_id);

      expect(row.revokedAt).toBeInstanceOf(Date);
      expect(row.revokedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(row.expiresAt).toEqual(FUTURE);
      expect(await isActive(_id)).toBe(false);
    },
  );

  it.each([
    ["false", false],
    ["zero", 0],
    ["an empty string", ""],
  ])(
    "clears a revokedAt of %s, which never revoked, keeping the token active",
    async (_, revokedAt) => {
      const _id = await insert({ expiresAt: FUTURE, revokedAt });
      expect(await isActive(_id)).toBe(true);

      await normaliseDates(db);

      const row = await rowOf(_id);

      expect(row.revokedAt).toBeNull();
      expect(row.expiresAt).toEqual(FUTURE);
      expect(await isActive(_id)).toBe(true);
    },
  );

  it.each([
    ["a date before 1970", BEFORE_1970],
    ["a date past year 9999", AFTER_9999],
    ["a number", 0],
    ["an array holding a date", [PAST]],
  ])(
    "dates a createdAt of %s by its ObjectId, still active",
    async (_, createdAt) => {
      const _id = await insert({ expiresAt: null, createdAt });

      await normaliseDates(db);

      expect((await rowOf(_id)).createdAt).toEqual(_id.getTimestamp());
      expect(await isActive(_id)).toBe(true);
    },
  );

  it("records a bad createdAt as unknown when the key is not an ObjectId", async () => {
    await accessTokens.insertOne({
      _id: "hand-made",
      clientId: "grants-ui",
      createdAt: "yesterday",
    });

    await normaliseDates(db);

    expect((await accessTokens.findOne({ _id: "hand-made" })).createdAt).toBe(
      null,
    );
  });

  it("leaves a hand-made row the reissue then moves undated, with its dates normalised", async () => {
    await accessTokens.insertOne({
      _id: "hand-made",
      id: "e".repeat(64),
      clientId: "grants-ui",
      expiresAt: String(FUTURE.getTime()),
      revokedAt: "yes",
      createdAt: "yesterday",
    });
    const before = new Date();

    await normaliseDates(db);
    await reissueAccessTokens(db, client);

    const [row] = await accessTokens.find({}).toArray();

    expect(row._id).toBeInstanceOf(ObjectId);
    expect(row.createdAt).toBeNull();
    expect(row.expiresAt).toEqual(FUTURE);
    expect(row.revokedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("leaves dates, null, a missing date and every other field alone", async () => {
    const dated = await insert({
      expiresAt: FUTURE,
      revokedAt: PAST,
      createdAt: PAST,
      tokenHint: "abcd",
    });
    const first = await insert({ expiresAt: new Date(0) });
    const never = await insert({ expiresAt: null });
    const missing = await insert({});
    const bad = await insert({ expiresAt: "never", createdBy: "Jane" });
    const before = await rowOf(bad);

    await normaliseDates(db);

    expect(await rowOf(dated)).toMatchObject({
      expiresAt: FUTURE,
      revokedAt: PAST,
      createdAt: PAST,
      tokenHint: "abcd",
    });
    expect(await expiryOf(first)).toEqual(new Date(0));
    expect(await expiryOf(never)).toBeNull();
    expect(await rowOf(missing)).toEqual({
      _id: missing,
      clientId: "grants-ui",
    });
    expect(await rowOf(bad)).toEqual({ ...before, expiresAt: null });
  });

  it("changes nothing when run again", async () => {
    await insert({ expiresAt: "never" });
    await insert({ expiresAt: -1 });
    await insert({ expiresAt: FUTURE.getTime() });
    await insert({ expiresAt: [null], revokedAt: "yes", createdAt: 0 });
    await insert({ revokedAt: false });
    await normaliseDates(db);
    const once = await accessTokens.find({}).toArray();

    await normaliseDates(db);

    expect(await accessTokens.find({}).toArray()).toEqual(once);
    expect(logger.info).toHaveBeenLastCalledWith(
      "Normalised the dates of 0 access tokens",
    );
  });

  it("leaves no expiry the boot report counts as not a date", async () => {
    await insert({ expiresAt: [FUTURE] });
    await insert({ expiresAt: "never" });
    await insert({ expiresAt: FUTURE });
    await insert({ expiresAt: null });
    await insert({});

    expect(await countIdentityShapes(accessTokens)).toMatchObject({
      nonDateExpiries: 2,
    });

    await normaliseDates(db);

    expect(await countIdentityShapes(accessTokens)).toMatchObject({
      nonDateExpiries: 0,
    });
  });

  it("logs only the count", async () => {
    await insert({ expiresAt: "never" });
    await insert({ expiresAt: null });

    await normaliseDates(db);

    expect(logger.info).toHaveBeenCalledWith(
      "Normalised the dates of 1 access tokens",
    );
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain(
      "never",
    );
  });
});
