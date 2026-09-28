import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { up as scheduleCompletedExpiry } from "../../migrations/20260921120000-expire-completed-events.js";
import { logger } from "../../src/common/logger.js";

const DAY_MS = 86_400_000;
const RETENTION_MS = 90 * DAY_MS;
const GRACE_MS = 14 * DAY_MS;
const TTL_INDEX = "expireAt_ttl";
const FILTER_JSON = '{"status":{"$in":["COMPLETED","PURGED"]}}';
// `$$NOW` is the mongod's clock, not this process's.
const CLOCK_SLACK_MS = 5000;

let client;
let db;
let now;
let alreadyScheduled;

// An ObjectId carries only seconds, so the insert-time fallback is rounded.
const idAt = (ms) => ObjectId.createFromTime(Math.floor(ms / 1000));
const toSecond = (ms) => Math.floor(ms / 1000) * 1000;
const iso = (ms) => new Date(ms).toISOString();

const seed = (ref, overrides = {}) => ({
  _id: idAt(now),
  messageId: `msg-${ref}`,
  segregationRef: ref,
  source: "CW",
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  event: { id: `evt-${ref}` },
  eventTime: "2026-06-16T08:00:00.000Z",
  publicationDate: "2026-06-16T09:00:00.000Z",
  status: "COMPLETED",
  // Below MAX_RETRIES, so the running service's sweep leaves these rows alone.
  completionAttempts: 1,
  completionDate: null,
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  ...overrides,
});

// Only statuses the live poller cannot move: anything else would be claimed or
// failed before the assertions ran.
const rows = (box) => [
  seed("floored", {
    _id: idAt(now - 200 * DAY_MS),
    completionDate: iso(now - 200 * DAY_MS),
  }),
  seed("recent", {
    _id: idAt(now - DAY_MS),
    completionDate: iso(now - DAY_MS),
  }),
  seed("garbage", {
    _id: idAt(now - 20 * DAY_MS),
    completionDate: "not-an-instant",
  }),
  seed("no-completion", { _id: idAt(now - 30 * DAY_MS) }),
  seed("string-id", { _id: `${box}-string-id` }),
  seed("explicit-null", {
    _id: idAt(now - 2 * DAY_MS),
    completionDate: iso(now - 2 * DAY_MS),
    expireAt: null,
  }),
  seed("already-scheduled", {
    _id: idAt(now - 40 * DAY_MS),
    completionDate: iso(now - 40 * DAY_MS),
    expireAt: alreadyScheduled,
  }),
  seed("dead-letter", {
    _id: idAt(now - 3 * DAY_MS),
    status: "DEAD_LETTER",
    expireAt: null,
  }),
  seed("processing", {
    _id: idAt(now - 4 * DAY_MS),
    status: "PROCESSING",
    claimedBy: "some-poller",
    claimedAt: new Date(now),
    claimExpiresAt: new Date(now + 3600_000),
  }),
];

const seedBoxes = async () => {
  await Promise.all([
    db.collection("inbox").insertMany(rows("inbox")),
    db.collection("outbox").insertMany(rows("outbox")),
  ]);
};

const byRef = async (box) =>
  Object.fromEntries(
    (await db.collection(box).find({}).toArray()).map((row) => [
      row.segregationRef,
      row,
    ]),
  );

// The floor is read inside the migration, so it can only be pinned to the
// window the run took.
const runMigration = async () => {
  const startedAt = Date.now();
  await scheduleCompletedExpiry(db);
  return { startedAt, finishedAt: Date.now() };
};

const expectWithin = (value, lower, upper) => {
  expect(value).toBeInstanceOf(Date);
  expect(value.getTime()).toBeGreaterThanOrEqual(lower);
  expect(value.getTime()).toBeLessThanOrEqual(upper);
};

const ttlIndex = async (box) =>
  (await db.collection(box).indexes()).find((i) => i.name === TTL_INDEX);

const linesFrom = (info) => info.mock.calls.map(([line]) => line);

const backfillLine = (info, box) =>
  linesFrom(info).find((line) => line.includes(`purged ${box} events`));

// Lets a test stand in for what Mongo reports back after the writes.
const overriding = (overrides) => ({
  collection: (name) =>
    new Proxy(db.collection(name), {
      get: (box, prop) => {
        const value = overrides[prop] ?? Reflect.get(box, prop);
        return typeof value === "function" ? value.bind(box) : value;
      },
    }),
});

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db();
  now = Date.now();
  alreadyScheduled = new Date(now + 365 * DAY_MS);
});

afterAll(async () => {
  // Leave the database as the service booted it.
  await scheduleCompletedExpiry(db);
  await client?.close();
});

describe.each(["inbox", "outbox"])("backfilling %s expiry", (box) => {
  it("takes the later of completion + 90 days and the 14-day floor", async () => {
    await seedBoxes();

    const { startedAt, finishedAt } = await runMigration();

    const found = await byRef(box);
    expectWithin(
      found.floored.expireAt,
      startedAt + GRACE_MS,
      finishedAt + GRACE_MS,
    );
    expect(found.recent.expireAt).toEqual(
      new Date(now - DAY_MS + RETENTION_MS),
    );
  });

  it("falls back to the insert instant when the completion date is unreadable or absent", async () => {
    await seedBoxes();

    await runMigration();

    const found = await byRef(box);
    expect(found.garbage.expireAt).toEqual(
      new Date(toSecond(now - 20 * DAY_MS) + RETENTION_MS),
    );
    expect(found["no-completion"].expireAt).toEqual(
      new Date(toSecond(now - 30 * DAY_MS) + RETENTION_MS),
    );
  });

  it("falls back to now for a row whose _id is a string", async () => {
    await seedBoxes();

    const { startedAt, finishedAt } = await runMigration();

    const found = await byRef(box);
    expectWithin(
      found["string-id"].expireAt,
      startedAt + RETENTION_MS - CLOCK_SLACK_MS,
      finishedAt + RETENTION_MS + CLOCK_SLACK_MS,
    );
  });

  it("schedules a completed row whose expireAt is an explicit null", async () => {
    await seedBoxes();

    await runMigration();

    const found = await byRef(box);
    expect(found["explicit-null"].expireAt).toEqual(
      new Date(now - 2 * DAY_MS + RETENTION_MS),
    );
  });

  it("leaves a row that already has an expireAt alone", async () => {
    await seedBoxes();

    await runMigration();

    expect((await byRef(box))["already-scheduled"].expireAt).toEqual(
      alreadyScheduled,
    );
  });

  it("takes the later of purge + 90 days and the 14-day floor for a purged row", async () => {
    await db.collection(box).insertMany([
      seed("purged-recent", {
        _id: idAt(now - 50 * DAY_MS),
        status: "PURGED",
        lastPurge: { at: iso(now - 2 * DAY_MS) },
        expireAt: null,
      }),
      seed("purged-old", {
        _id: idAt(now - 300 * DAY_MS),
        status: "PURGED",
        lastPurge: { at: iso(now - 200 * DAY_MS) },
      }),
      seed("purged-no-record", {
        _id: idAt(now - 60 * DAY_MS),
        status: "PURGED",
        expireAt: null,
      }),
    ]);

    const { startedAt, finishedAt } = await runMigration();

    const found = await byRef(box);
    expect(found["purged-recent"].expireAt).toEqual(
      new Date(now - 2 * DAY_MS + RETENTION_MS),
    );
    expectWithin(
      found["purged-old"].expireAt,
      startedAt + GRACE_MS,
      finishedAt + GRACE_MS,
    );
    expect(found["purged-no-record"].expireAt).toEqual(
      new Date(toSecond(now - 60 * DAY_MS) + RETENTION_MS),
    );
  });

  it("never schedules a row that is neither COMPLETED nor PURGED", async () => {
    await seedBoxes();
    const before = await byRef(box);

    await runMigration();

    const after = await byRef(box);
    expect(after["dead-letter"]).toEqual(before["dead-letter"]);
    expect(after.processing).toEqual(before.processing);
    expect(after["dead-letter"].expireAt).toBeNull();
    expect(after.processing.expireAt).toBeUndefined();
  });

  it("changes nothing on a second run", async () => {
    await seedBoxes();

    await runMigration();
    const once = await db.collection(box).find({}).sort({ _id: 1 }).toArray();
    await runMigration();

    expect(
      await db.collection(box).find({}).sort({ _id: 1 }).toArray(),
    ).toEqual(once);
  });

  it("creates the partial TTL index, and re-creating it is a no-op", async () => {
    await seedBoxes();

    await runMigration();
    await runMigration();

    expect(await ttlIndex(box)).toMatchObject({
      name: "expireAt_ttl",
      key: { expireAt: 1 },
      expireAfterSeconds: 0,
      partialFilterExpression: { status: { $in: ["COMPLETED", "PURGED"] } },
    });
  });

  // A non-Date sorts before every Date, so an unreadable value would be picked
  // as the earliest and then throw on the way to the log line.
  it("reports the earliest real date and leaves an unreadable expireAt alone", async () => {
    const stringExpiry = "2029-01-01T00:00:00.000Z";
    const dateExpiry = new Date(now + 30 * DAY_MS);
    await db.collection(box).insertMany([
      seed("string-expiry", {
        _id: idAt(now - 5 * DAY_MS),
        completionDate: iso(now - 5 * DAY_MS),
        expireAt: stringExpiry,
      }),
      seed("date-expiry", {
        _id: idAt(now - 6 * DAY_MS),
        completionDate: iso(now - 6 * DAY_MS),
        expireAt: dateExpiry,
      }),
    ]);
    const info = vi.spyOn(logger, "info");

    await expect(scheduleCompletedExpiry(db)).resolves.toBeUndefined();

    const found = await byRef(box);
    expect(found["string-expiry"].expireAt).toBe(stringExpiry);
    expect(found["date-expiry"].expireAt).toEqual(dateExpiry);
    expect(backfillLine(info, box)).toContain(
      `earliest ${dateExpiry.toISOString()}`,
    );
  });
});

describe("the verification logs", () => {
  it("report every backfilled row and none still unscheduled", async () => {
    await seedBoxes();
    const info = vi.spyOn(logger, "info");

    const { startedAt } = await runMigration();

    for (const box of ["inbox", "outbox"]) {
      const line = backfillLine(info, box);
      expect(line).toMatch(
        new RegExp(
          `^Scheduled expiry on 6 completed and 0 purged ${box} events; 0 still unscheduled; earliest \\d{4}-\\d{2}-\\d{2}T\\S+$`,
        ),
      );

      // The oldest row in the history is the one sitting on the floor.
      const earliest = new Date(line.slice(line.lastIndexOf(" ") + 1));
      expect(earliest.getTime()).toBeGreaterThanOrEqual(startedAt + GRACE_MS);
    }
  });

  it("report a purged row with no date as scheduled", async () => {
    await seedBoxes();
    await db.collection("inbox").insertOne(
      seed("purged-unscheduled", {
        _id: idAt(now - 5 * DAY_MS),
        status: "PURGED",
        expireAt: null,
      }),
    );
    const info = vi.spyOn(logger, "info");

    await runMigration();

    expect((await byRef("inbox"))["purged-unscheduled"].expireAt).toEqual(
      new Date(toSecond(now - 5 * DAY_MS) + RETENTION_MS),
    );
    expect(backfillLine(info, "inbox")).toContain(
      "Scheduled expiry on 6 completed and 1 purged inbox events; 0 still unscheduled;",
    );
    expect(backfillLine(info, "outbox")).toContain("0 still unscheduled;");
  });

  it("report the TTL index and its filter for both boxes", async () => {
    await seedBoxes();
    const info = vi.spyOn(logger, "info");

    await runMigration();

    const lines = linesFrom(info);
    expect(lines).toContain(
      `TTL index ${TTL_INDEX} on inbox: present, filter ${FILTER_JSON}`,
    );
    expect(lines).toContain(
      `TTL index ${TTL_INDEX} on outbox: present, filter ${FILTER_JSON}`,
    );
  });

  it("report nothing left to do on a second run", async () => {
    await seedBoxes();
    await runMigration();
    const info = vi.spyOn(logger, "info");

    await runMigration();

    expect(linesFrom(info)).toContainEqual(
      expect.stringContaining(
        "Scheduled expiry on 0 completed and 0 purged inbox events; 0 still unscheduled;",
      ),
    );
  });
});

describe("the postcondition", () => {
  it("fails the migration when the index exists with other options", async () => {
    const inbox = db.collection("inbox");
    await inbox.dropIndex(TTL_INDEX);
    await inbox.createIndex(
      { expireAt: 1 },
      { name: TTL_INDEX, expireAfterSeconds: 60 },
    );

    try {
      await expect(scheduleCompletedExpiry(db)).rejects.toThrow();
    } finally {
      await inbox.dropIndex(TTL_INDEX);
      await scheduleCompletedExpiry(db);
    }
  });

  it("fails the migration when the index is missing afterwards", async () => {
    const empty = () => ({ toArray: async () => [] });

    await expect(
      scheduleCompletedExpiry(overriding({ listIndexes: empty })),
    ).rejects.toThrow(`TTL index ${TTL_INDEX} on inbox is missing`);
  });

  it("fails the migration when the index has other options afterwards", async () => {
    const wrong = () => ({
      toArray: async () => [
        { name: TTL_INDEX, key: { expireAt: 1 }, expireAfterSeconds: 60 },
      ],
    });

    await expect(
      scheduleCompletedExpiry(overriding({ listIndexes: wrong })),
    ).rejects.toThrow(`TTL index ${TTL_INDEX} on inbox is {`);
  });
});

describe("the migration module", () => {
  it("exports up and nothing else", async () => {
    const migration =
      await import("../../migrations/20260921120000-expire-completed-events.js");

    expect(Object.keys(migration)).toEqual(["up"]);
  });
});
