import { MongoClient, ObjectId } from "mongodb";
import { setTimeout as sleep } from "node:timers/promises";
import { GenericContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { up as scheduleCompletedExpiry } from "../../migrations/20260921120000-expire-completed-events.js";

// Its own throwaway mongod: the shared harness runs the stock TTL monitor,
// which wakes once a minute. `ttlMonitorSleepSecs=1` is the only reason this is
// not another case in the migration test.

const DAY_MS = 86_400_000;
const TTL_IMAGE = "mongo:6.0.13";
const DELETION_TIMEOUT_MS = 30_000;
const POLL_MS = 250;

let container;
let client;
let db;
let past;
let future;

const seed = (ref, overrides) => ({
  _id: new ObjectId(),
  messageId: `msg-${ref}`,
  segregationRef: ref,
  source: "CW",
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  eventTime: "2026-06-16T08:00:00.000Z",
  publicationDate: "2026-06-16T09:00:00.000Z",
  completionAttempts: 1,
  status: "COMPLETED",
  ...overrides,
});

const rows = () => [
  seed("completed-past", { expireAt: past }),
  seed("purged-past", { status: "PURGED", expireAt: past }),
  // The partial filter is the whole guarantee: these survive a past date.
  seed("dead-letter-past", { status: "DEAD_LETTER", expireAt: past }),
  seed("resubmitted-past", { status: "RESUBMITTED", expireAt: past }),
  // Not a BSON Date, so the TTL monitor ignores it.
  seed("completed-string", { expireAt: past.toISOString() }),
  seed("completed-null", { expireAt: null }),
  seed("completed-missing", {}),
  seed("completed-future", { expireAt: future }),
];

const survivors = async (box) =>
  (await db.collection(box).find({}).toArray())
    .map((row) => row.segregationRef)
    .sort();

const waitForDeletions = async (box) => {
  const deadline = Date.now() + DELETION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const remaining = await db.collection(box).countDocuments({
      segregationRef: { $in: ["completed-past", "purged-past"] },
    });

    if (remaining === 0) {
      return true;
    }

    await sleep(POLL_MS);
  }

  return false;
};

beforeAll(async () => {
  container = await new GenericContainer(TTL_IMAGE)
    // The default bridge, and no fixed host port: it never joins the project's
    // compose network.
    .withCommand([
      "mongod",
      "--bind_ip_all",
      "--setParameter",
      "ttlMonitorSleepSecs=1",
    ])
    .withExposedPorts(27017)
    .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
    .start();

  client = await MongoClient.connect(
    `mongodb://${container.getHost()}:${container.getMappedPort(27017)}/ttl-probe?directConnection=true`,
  );
  db = client.db();

  past = new Date(Date.now() - DAY_MS);
  future = new Date(Date.now() + 365 * DAY_MS);

  // Against an empty database, so the backfill never rewrites the null and
  // missing rows the TTL monitor is meant to ignore.
  await scheduleCompletedExpiry(db);
}, 180_000);

afterAll(async () => {
  await client?.close();
  await container?.stop();
}, 60_000);

describe.each(["inbox", "outbox"])(
  "the %s TTL index the migration creates",
  (box) => {
    it("deletes completed and purged rows whose date has passed, and nothing else", async () => {
      await db.collection(box).insertMany(rows());

      expect(await waitForDeletions(box)).toBe(true);
      expect(await survivors(box)).toEqual([
        "completed-future",
        "completed-missing",
        "completed-null",
        "completed-string",
        "dead-letter-past",
        "resubmitted-past",
      ]);
    }, 60_000);
  },
);
