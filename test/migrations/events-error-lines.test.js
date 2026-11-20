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
} from "../../migrations/20261119120000-events-error-lines.js";

vi.mock("../../src/common/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let replSet;
let client;
let db;

const LIST = { publicationDate: -1, _id: -1 };

// The outbox as the last release left it, retired lines included.
const before = [
  { status: 1, completionAttempts: 1 },
  { publicationDate: -1, _id: -1 },
  { status: 1, ...LIST },
  { eventType: 1, ...LIST },
  { eventType: 1, status: 1, ...LIST },
  { eventType: 1, status: 1, "lastError.name": 1, ...LIST },
  { status: 1, errorKey: 1, eventType: 1, ...LIST },
  { refs: 1, ...LIST },
  { eventType: 1, status: 1, errorKey: 1, ...LIST },
  { eventType: 1, refs: 1, ...LIST },
];

const added = [
  { status: 1, "lastError.name": 1, ...LIST },
  { status: 1, errorKey: 1, ...LIST },
];

const keysOf = async (box) =>
  (await db.collection(box).indexes())
    .map(({ key }) => JSON.stringify(key))
    .filter((key) => key !== '{"_id":1}')
    .sort();

const sorted = (keys) => keys.map((key) => JSON.stringify(key)).sort();

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = await MongoClient.connect(replSet.getUri());
  db = client.db("events-error-lines");
}, 120_000);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  await db.dropDatabase();
  await db.createCollection("outbox");

  for (const key of before) {
    await db.collection("outbox").createIndex(key);
  }
});

describe("20261119120000-events-error-lines", () => {
  it("adds exactly the outbox's two error lines", async () => {
    await up(db);

    expect(await keysOf("outbox")).toEqual(sorted([...before, ...added]));
  });

  it("builds an outbox line that is missing", async () => {
    await db.collection("outbox").dropIndex({ status: 1, ...LIST });

    await up(db);

    expect(await keysOf("outbox")).toEqual(sorted([...before, ...added]));
  });

  it("runs again with nothing left to do", async () => {
    await up(db);
    const once = await keysOf("outbox");

    await up(db);

    expect(await keysOf("outbox")).toEqual(once);
  });

  it("drops exactly the two lines on the way down, leaving every other index", async () => {
    await up(db);
    await down(db);

    expect(await keysOf("outbox")).toEqual(sorted(before));
  });

  it("goes down again without failing when the lines are already gone", async () => {
    await up(db);
    await down(db);

    await expect(down(db)).resolves.toBeUndefined();
    expect(await keysOf("outbox")).toEqual(sorted(before));
  });
});
