import { Collection } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ledBucket, testBucket } from "./test-bucket.js";

vi.mock("../logger.js");

const HOUR = 60 * 60 * 1000;
const FROM = Date.UTC(2026, 8, 1);
const DAY = 24 * HOUR;
const STATUSES = ["COMPLETED", "COMPLETED", "COMPLETED", "DEAD_LETTER"];

// A row every 90 seconds over three days, the middle one counted.
const ROWS = (3 * DAY) / (90 * 1000);

const row = (n) => ({
  publicationDate: new Date(FROM - DAY + n * 90 * 1000),
  status: STATUSES[n % STATUSES.length],
  eventType: n % 10 === 0 ? "audit" : "case.create",
});

const led = ledBucket({ collection: "led" });
const text = testBucket({
  collection: "text",
  time: { field: "publicationDate", type: "isoString", label: "Received" },
});

let replSet;
let mongoClient;
let db;
let countBins;
let ensureIndexes;

const aggregations = [];
const aggregate = Collection.prototype.aggregate;

const stagesOf = (plan) => [
  plan.stage,
  ...[plan.inputStage, ...(plan.inputStages ?? [])]
    .filter(Boolean)
    .flatMap(stagesOf),
];

const explain = async (bucket, [pipeline, options]) => {
  const answer = await aggregate
    .call(db.collection(bucket.collection), pipeline, options)
    .explain("executionStats");
  const cursor = answer.stages?.[0].$cursor ?? answer;
  const winning =
    cursor.queryPlanner.winningPlan.queryPlan ??
    cursor.queryPlanner.winningPlan;

  return {
    stages: stagesOf(winning),
    keysExamined: cursor.executionStats.totalKeysExamined,
    docsExamined: cursor.executionStats.totalDocsExamined,
  };
};

const window = { from: new Date(FROM), to: new Date(FROM + DAY) };

const countedIn = (bucket) =>
  countBins(bucket, {
    where: { status: "DEAD_LETTER" },
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    binMs: 2 * HOUR,
  });

const isCounted = (keep) => (n) => {
  const { publicationDate, status, eventType } = row(n);
  const t = publicationDate.getTime();

  return (
    status === "DEAD_LETTER" &&
    keep(eventType) &&
    t >= window.from.getTime() &&
    t <= window.to.getTime()
  );
};

const expected = (keep) => {
  const counts = Array.from({ length: 12 }, () => 0);

  for (let n = 0; n < ROWS; n++) {
    if (isCounted(keep)(n)) {
      const t = row(n).publicationDate.getTime();
      counts[Math.min(11, Math.floor((t - FROM) / (2 * HOUR)))] += 1;
    }
  }

  // The dead letter created at `to` itself, counted in the last bin.
  counts[11] += 1;

  return counts;
};

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", "bucket-bins-test");
  vi.resetModules();

  ({ mongoClient, db } = await import("../mongo-client.js"));
  ({ countBins } = await import("./bins.js"));
  ({ ensureIndexes } = await import("./indexes.js"));

  await mongoClient.connect();
  const rows = Array.from({ length: ROWS }, (_, n) => row(n));
  await db.collection(led.collection).insertMany(rows);
  await db.collection(text.collection).insertMany(
    rows.map((doc) => ({
      ...doc,
      publicationDate: doc.publicationDate.toISOString(),
    })),
  );
  await db.collection(led.collection).insertOne({
    publicationDate: window.to,
    status: "DEAD_LETTER",
    eventType: "case.create",
  });
  await db.collection(text.collection).insertOne({
    publicationDate: window.to.toISOString(),
    status: "DEAD_LETTER",
    eventType: "case.create",
  });
  await ensureIndexes(db, led);
  await ensureIndexes(db, text);

  Collection.prototype.aggregate = function (...args) {
    aggregations.push(args);
    return aggregate.apply(this, args);
  };
}, 120_000);

afterAll(async () => {
  Collection.prototype.aggregate = aggregate;
  await mongoClient?.close();
  await replSet?.stop();
});

describe("countBins on MongoDB", () => {
  it("counts the window's rows in each bin, on the filled lead", async () => {
    const bins = await countedIn(led);

    expect(bins.map(({ count }) => count)).toEqual(expected(() => true));
    expect(bins.reduce((sum, { count }) => sum + count, 0)).toBe(241);
  });

  it("reads a time stored as text the same way", async () => {
    const bins = await countedIn(text);

    expect(bins.map(({ count }) => count)).toEqual(expected(() => true));
  });

  // A filled lead holds null, which an index key cannot tell from a missing
  // field, so each match is read; nothing outside the window's matches is.
  it("reads only the window's matches", async () => {
    aggregations.length = 0;
    const bins = await countedIn(led);
    const counted = bins.reduce((sum, { count }) => sum + count, 0);
    const { stages, keysExamined, docsExamined } = await explain(
      led,
      aggregations[0],
    );

    expect(stages).toContain("IXSCAN");
    expect(docsExamined).toBe(counted);
    // One key per match, and one more at the edge of each interval.
    expect(keysExamined).toBeLessThanOrEqual(counted + 4);
  });

  it("reads only the index keys of the matches when nothing is filled", async () => {
    aggregations.length = 0;
    const bins = await countedIn(text);
    const counted = bins.reduce((sum, { count }) => sum + count, 0);
    const { stages, keysExamined, docsExamined } = await explain(
      text,
      aggregations[0],
    );

    expect(stages).toContain("IXSCAN");
    expect(stages).not.toContain("FETCH");
    expect(docsExamined).toBe(0);
    expect(keysExamined).toBeLessThanOrEqual(counted + 1);
  });
});
