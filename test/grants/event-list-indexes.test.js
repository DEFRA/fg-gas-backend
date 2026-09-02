import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  up as createEventListIndexes,
  down as dropEventListIndexes,
} from "../../migrations/20260901120000-add-event-list-indexes.js";

const INBOX_INDEX = "eventTime_-1__id_-1";
const OUTBOX_INDEX = "publicationDate_-1__id_-1";

let client;
let db;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db();
});

afterAll(async () => {
  // Leave the database as the service booted it, whatever the tests did.
  await createEventListIndexes(db);
  await client?.close();
});

const indexNames = async (name) =>
  (await db.collection(name).indexes()).map((i) => i.name);

describe("event list indexes", () => {
  it("exist on inbox and outbox after the service boots", async () => {
    // The containerised GAS runs migrations during plugin registration, so
    // these indexes are already in place before any test runs.
    expect(await indexNames("inbox")).toContain(INBOX_INDEX);
    expect(await indexNames("outbox")).toContain(OUTBOX_INDEX);
  });

  it("are keyed newest-first with the _id tie-breaker", async () => {
    const inboxIndex = (await db.collection("inbox").indexes()).find(
      (i) => i.name === INBOX_INDEX,
    );
    const outboxIndex = (await db.collection("outbox").indexes()).find(
      (i) => i.name === OUTBOX_INDEX,
    );

    expect(inboxIndex.key).toEqual({ eventTime: -1, _id: -1 });
    expect(outboxIndex.key).toEqual({ publicationDate: -1, _id: -1 });
  });

  it("serve the list query with an index scan rather than a collection scan", async () => {
    await db.collection("inbox").insertMany(
      Array.from({ length: 5 }, (_, n) => ({
        eventTime: `2026-06-16T10:0${n}:00.000Z`,
        status: "PUBLISHED",
      })),
    );

    const plan = await db
      .collection("inbox")
      .find({})
      .sort({ eventTime: -1, _id: -1 })
      .limit(21)
      .explain("queryPlanner");

    expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain("IXSCAN");
  });

  it("can be re-applied idempotently", async () => {
    await createEventListIndexes(db);
    await createEventListIndexes(db);

    expect(await indexNames("inbox")).toContain(INBOX_INDEX);
    expect(await indexNames("outbox")).toContain(OUTBOX_INDEX);
  });

  it("are dropped by down and restored by up", async () => {
    await dropEventListIndexes(db);

    expect(await indexNames("inbox")).not.toContain(INBOX_INDEX);
    expect(await indexNames("outbox")).not.toContain(OUTBOX_INDEX);

    await createEventListIndexes(db);

    expect(await indexNames("inbox")).toContain(INBOX_INDEX);
    expect(await indexNames("outbox")).toContain(OUTBOX_INDEX);
  });
});
