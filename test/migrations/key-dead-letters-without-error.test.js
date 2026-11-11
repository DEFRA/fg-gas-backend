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
import { up } from "../../migrations/20261111120000-key-dead-letters-without-error.js";

vi.mock("../../src/common/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let replSet;
let client;
let db;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = await MongoClient.connect(replSet.getUri());
  db = client.db("key-dead-letters-without-error");
}, 120_000);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  await db.collection("outbox").deleteMany({});
  await db.collection("inbox").deleteMany({});
});

const aRow = (status, fields = {}) => ({
  _id: new ObjectId(),
  status,
  ...fields,
});

const keysOf = async (box) =>
  Object.fromEntries(
    (await db.collection(box).find().toArray()).map(({ _id, errorKey }) => [
      _id.toHexString(),
      errorKey,
    ]),
  );

describe("20261111120000-key-dead-letters-without-error", () => {
  it.each(["outbox", "inbox"])(
    "keys the %s's dead and purged rows, and no other",
    async (box) => {
      const dead = aRow("DEAD_LETTER");
      const purged = aRow("PURGED", { errorKey: null, lastError: null });
      const erred = aRow("DEAD_LETTER", {
        lastError: { name: "TypeError", message: 'cannot read "abc-123"' },
      });
      const keyed = aRow("DEAD_LETTER", { errorKey: "Error: kept" });
      const completed = aRow("COMPLETED", { errorKey: null });
      const failed = aRow("FAILED");
      await db
        .collection(box)
        .insertMany([dead, purged, erred, keyed, completed, failed]);

      await up(db);

      expect(await keysOf(box)).toEqual({
        [dead._id.toHexString()]: "No error recorded",
        [purged._id.toHexString()]: "No error recorded",
        [erred._id.toHexString()]: "TypeError: cannot read <v>",
        [keyed._id.toHexString()]: "Error: kept",
        [completed._id.toHexString()]: null,
        [failed._id.toHexString()]: undefined,
      });
    },
  );

  it("changes nothing when run again", async () => {
    await db.collection("inbox").insertMany([aRow("DEAD_LETTER")]);
    await up(db);
    const before = await keysOf("inbox");

    await up(db);

    expect(await keysOf("inbox")).toEqual(before);
  });
});
