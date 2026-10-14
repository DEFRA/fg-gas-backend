import { Collection, MongoClient } from "mongodb";
import { env } from "node:process";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { up as addAllowListIndex } from "../../migrations/20261013120000-add-allow-list-index.js";

const COLLECTION = "allow_lists";
const OUT_OF_BAND_INDEX = "one_allow_list_per_grant";

let client;
let db;
let allowLists;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db();
});

beforeEach(async () => {
  await db
    .collection(COLLECTION)
    .drop()
    .catch(() => undefined);
  allowLists = db.collection(COLLECTION);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db
    ?.collection(COLLECTION)
    .drop()
    .catch(() => undefined);
  await client?.close();
});

describe("allow-list grant identity index", () => {
  it("creates a unique grant-code index", async () => {
    await addAllowListIndex(db);

    const index = (await allowLists.indexes()).find(
      ({ key }) => key.grantCode === 1,
    );
    expect(index).toEqual(
      expect.objectContaining({ key: { grantCode: 1 }, unique: true }),
    );
  });

  it("prevents two allow lists for one grant", async () => {
    await addAllowListIndex(db);
    await allowLists.insertOne({ grantCode: "woodland" });

    await expect(
      allowLists.insertOne({ grantCode: "woodland" }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("can be reapplied", async () => {
    await addAllowListIndex(db);

    await expect(addAllowListIndex(db)).resolves.toBeUndefined();
    expect(
      (await allowLists.indexes()).filter(({ key }) => key.grantCode === 1),
    ).toHaveLength(1);
  });

  it("accepts an equivalent unique index built under another name", async () => {
    await allowLists.createIndex(
      { grantCode: 1 },
      { name: OUT_OF_BAND_INDEX, unique: true },
    );
    const createIndex = vi.spyOn(Collection.prototype, "createIndex");

    await addAllowListIndex(db);

    expect(createIndex).not.toHaveBeenCalled();
  });

  it.each([
    ["non-unique", {}],
    ["partial", { unique: true, partialFilterExpression: { active: true } }],
    ["sparse", { unique: true, sparse: true }],
    ["hidden", { unique: true, hidden: true }],
    ["collated", { unique: true, collation: { locale: "en" } }],
  ])("refuses an equivalent %s index", async (_, options) => {
    await allowLists.createIndex(
      { grantCode: 1 },
      { name: OUT_OF_BAND_INDEX, ...options },
    );

    await expect(addAllowListIndex(db)).rejects.toThrow(
      `Index ${OUT_OF_BAND_INDEX} on ${COLLECTION} must be unique and must not be partial, collated, hidden or sparse`,
    );
  });

  it("exports up and nothing else", async () => {
    const migration =
      await import("../../migrations/20261013120000-add-allow-list-index.js");

    expect(Object.keys(migration)).toEqual(["up"]);
  });
});
