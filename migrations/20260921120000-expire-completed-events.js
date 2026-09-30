import { logger } from "../src/common/logger.js";

// Literals only, and nothing from `src` but the logger: what a migration did
// must not change when the retention config later does.

const DAY_MS = 86_400_000;
const RETENTION_DAYS = 90;
// A floor under every backfilled date, leaving time to drop the index if the
// deploy looks wrong.
const GRACE_DAYS = 14;

const TTL_INDEX = "expireAt_ttl";
const EXPIRING_STATUSES = ["COMPLETED", "PURGED"];
const BOXES = ["inbox", "outbox"];

const insertedAt = {
  $convert: { input: "$_id", to: "date", onError: "$$NOW", onNull: "$$NOW" },
};

const completedAt = {
  $convert: {
    input: "$completionDate",
    to: "date",
    onError: insertedAt,
    onNull: insertedAt,
  },
};

const purgedAt = {
  $convert: {
    input: "$lastPurge.at",
    to: "date",
    onError: insertedAt,
    onNull: insertedAt,
  },
};

const scheduleExpiry = (box, status, from, floor) =>
  box.updateMany(
    // `expireAt: null` matches a missing field and an explicit null. The
    // null is a row a new pod inserted and an old pod completed mid-deploy,
    // which `$exists: false` would miss.
    { status, expireAt: null },
    [
      {
        $set: {
          expireAt: {
            $max: [{ $add: [from, RETENTION_DAYS * DAY_MS] }, floor],
          },
        },
      },
    ],
  );

// An identical re-create is a no-op, so two pods may run this at once
// (`lockTtl: 0` disables migrate-mongo's lock).
const createTtlIndex = (box) =>
  box.createIndex(
    { expireAt: 1 },
    {
      name: TTL_INDEX,
      expireAfterSeconds: 0,
      partialFilterExpression: { status: { $in: EXPIRING_STATUSES } },
    },
  );

const countUnscheduled = (box) =>
  box.countDocuments({
    status: { $in: EXPIRING_STATUSES },
    expireAt: null,
  });

// A non-Date sorts before every Date, so without the type filter an
// unreadable value would be reported as the earliest and then throw on
// `toISOString` - after the backfill, before the changelog entry.
const findEarliestExpiry = async (box) => {
  const doc = await box.findOne(
    { status: { $in: EXPIRING_STATUSES }, expireAt: { $type: "date" } },
    { sort: { expireAt: 1 }, projection: { expireAt: 1 } },
  );

  return doc ? doc.expireAt.toISOString() : "none";
};

const readTtlIndex = async (box) => {
  const indexes = await box.listIndexes().toArray();

  return indexes.find((index) => index.name === TTL_INDEX);
};

const EXPECTED_INDEX = JSON.stringify({
  key: { expireAt: 1 },
  expireAfterSeconds: 0,
  partialFilterExpression: { status: { $in: EXPIRING_STATUSES } },
});

const describeIndex = (index) =>
  JSON.stringify({
    key: index.key,
    expireAfterSeconds: index.expireAfterSeconds,
    partialFilterExpression: index.partialFilterExpression,
  });

// Throwing keeps migrate-mongo from recording the migration as applied.
const assertIndex = (name, index) => {
  if (!index) {
    throw new Error(`TTL index ${TTL_INDEX} on ${name} is missing`);
  }

  if (describeIndex(index) !== EXPECTED_INDEX) {
    throw new Error(
      `TTL index ${TTL_INDEX} on ${name} is ${describeIndex(index)}, expected ${EXPECTED_INDEX}`,
    );
  }
};

export const up = async (db) => {
  const floor = new Date(Date.now() + GRACE_DAYS * DAY_MS);

  for (const name of BOXES) {
    const box = db.collection(name);

    const completed = await scheduleExpiry(
      box,
      "COMPLETED",
      completedAt,
      floor,
    );
    const purged = await scheduleExpiry(box, "PURGED", purgedAt, floor);
    await createTtlIndex(box);

    const unscheduled = await countUnscheduled(box);
    const earliest = await findEarliestExpiry(box);

    logger.info(
      `Scheduled expiry on ${completed.modifiedCount} completed and ${purged.modifiedCount} purged ${name} events; ${unscheduled} still unscheduled; earliest ${earliest}`,
    );

    const index = await readTtlIndex(box);
    const filterJson = JSON.stringify(index?.partialFilterExpression ?? null);

    logger.info(
      `TTL index ${TTL_INDEX} on ${name}: ${index ? "present" : "MISSING"}, filter ${filterJson}`,
    );

    assertIndex(name, index);
  }
};
