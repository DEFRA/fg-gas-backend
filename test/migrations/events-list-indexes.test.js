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
import {
  down,
  up,
} from "../../migrations/20261112120000-events-list-indexes.js";
import {
  down as restoreRetired,
  up as dropRetired,
} from "../../migrations/next/20261113120000-drop-retired-events-indexes.js";

vi.mock("../../src/common/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let replSet;
let client;
let db;

const LIST = { publicationDate: -1, _id: -1 };

// The boxes as the last release left them: the outbox led by its event type.
const before = {
  outbox: [
    { status: 1, completionAttempts: 1 },
    { publicationDate: -1, _id: -1 },
    { status: 1, ...LIST },
    { eventType: 1, ...LIST },
    { eventType: 1, status: 1, ...LIST },
    { eventType: 1, status: 1, "lastError.name": 1, ...LIST },
    { eventType: 1, status: 1, errorKey: 1, ...LIST },
    { eventType: 1, refs: 1, ...LIST },
  ],
  inbox: [
    { status: 1, eventTime: -1, _id: -1 },
    { publicationDate: -1, _id: -1 },
    { status: 1, ...LIST },
    { status: 1, eventType: 1, ...LIST },
    { status: 1, "lastError.name": 1, ...LIST },
    { status: 1, errorKey: 1, eventType: 1, ...LIST },
    { refs: 1, ...LIST },
  ],
};

const keysOf = async (box) =>
  (await db.collection(box).indexes())
    .map(({ key }) => JSON.stringify(key))
    .filter((key) => key !== '{"_id":1}')
    .sort();

const sorted = (keys) => keys.map((key) => JSON.stringify(key)).sort();

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = await MongoClient.connect(replSet.getUri());
  db = client.db("events-list-indexes");
}, 120_000);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  await db.dropDatabase();

  for (const [box, keys] of Object.entries(before)) {
    await db.createCollection(box);
    for (const key of keys) {
      await db.collection(box).createIndex(key);
    }
  }
});

const after = {
  outbox: [
    { status: 1, completionAttempts: 1 },
    { publicationDate: -1, _id: -1 },
    { status: 1, ...LIST },
    { eventType: 1, ...LIST },
    { eventType: 1, status: 1, ...LIST },
    { eventType: 1, status: 1, "lastError.name": 1, ...LIST },
    { status: 1, errorKey: 1, eventType: 1, ...LIST },
    { refs: 1, ...LIST },
  ],
  inbox: [
    { status: 1, eventTime: -1, _id: -1 },
    { publicationDate: -1, _id: -1 },
    { status: 1, ...LIST },
    { eventType: 1, ...LIST },
    { eventType: 1, status: 1, ...LIST },
    { status: 1, "lastError.name": 1, ...LIST },
    { status: 1, errorKey: 1, eventType: 1, ...LIST },
    { refs: 1, ...LIST },
  ],
};

const retired = {
  outbox: [
    { eventType: 1, status: 1, errorKey: 1, ...LIST },
    { eventType: 1, refs: 1, ...LIST },
  ],
  inbox: [{ status: 1, eventType: 1, ...LIST }],
};

describe("20261112120000-events-list-indexes", () => {
  it("adds one list index per filter shape, and the error and refs lines, keeping every index the last release reads", async () => {
    await up(db);

    expect(await keysOf("outbox")).toEqual(
      sorted([...after.outbox, ...retired.outbox]),
    );
    expect(await keysOf("inbox")).toEqual(
      sorted([...after.inbox, ...retired.inbox]),
    );
  });

  it("builds a list index a box lacks, the outbox's date-only one among them", async () => {
    await db.collection("outbox").dropIndex({ publicationDate: -1, _id: -1 });

    await up(db);

    expect(await keysOf("outbox")).toContain(
      JSON.stringify({ publicationDate: -1, _id: -1 }),
    );
  });

  it("runs again with nothing left to do", async () => {
    await up(db);
    const once = [await keysOf("outbox"), await keysOf("inbox")];

    await up(db);

    expect([await keysOf("outbox"), await keysOf("inbox")]).toEqual(once);
  });

  it("puts the boxes back as they were on the way down", async () => {
    await up(db);
    await down(db);

    expect(await keysOf("outbox")).toEqual(sorted(before.outbox));
    expect(await keysOf("inbox")).toEqual(sorted(before.inbox));
  });
});

describe("next/20261113120000-drop-retired-events-indexes", () => {
  it("drops what the last release read and this one doesn't, leaving the boxes as the buckets read them", async () => {
    await up(db);
    await dropRetired(db);

    expect(await keysOf("outbox")).toEqual(sorted(after.outbox));
    expect(await keysOf("inbox")).toEqual(sorted(after.inbox));
  });

  it("builds them again on the way down", async () => {
    await up(db);
    await dropRetired(db);
    await restoreRetired(db);

    expect(await keysOf("outbox")).toEqual(
      sorted([...after.outbox, ...retired.outbox]),
    );
  });
});
