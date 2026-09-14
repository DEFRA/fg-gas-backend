import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { up as createStatusIndexes } from "../../migrations/20260908120000-add-status-filtered-list-indexes.js";

// The status chip is the most-clicked control on the admin events page. Before
// this index it had nothing to walk: the query either scanned the list index
// discarding nearly every entry, or took the poller's own index and top-k
// sorted every match - a near-full scan of a box per page turn.

const INBOX_INDEX = "status_1_eventTime_-1__id_-1";
const OUTBOX_INDEX = "status_1_publicationDate_-1__id_-1";
const SCOPE = "STATUS-INDEX-PROBE";

let client;
let db;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db();
});

afterAll(async () => {
  await db.collection("inbox").deleteMany({ segregationRef: SCOPE });
  // Leave the database as the service booted it, whatever the tests did.
  await createStatusIndexes(db);
  await client?.close();
});

const indexNames = async (name) =>
  (await db.collection(name).indexes()).map((i) => i.name);

describe("status-filtered list indexes", () => {
  it("exist on both boxes after the service boots", async () => {
    expect(await indexNames("inbox")).toContain(INBOX_INDEX);
    expect(await indexNames("outbox")).toContain(OUTBOX_INDEX);
  });

  // Equality on the prefix, then the keyset order for free.
  it("put the status first and keep the list's own order behind it", async () => {
    const inboxIndex = (await db.collection("inbox").indexes()).find(
      (i) => i.name === INBOX_INDEX,
    );

    expect(inboxIndex.key).toEqual({ status: 1, eventTime: -1, _id: -1 });
  });

  it("serve a status-filtered page as a range scan rather than a sort", async () => {
    await db.collection("inbox").insertMany(
      Array.from({ length: 5 }, (_, n) => ({
        eventTime: `2026-06-16T10:0${n}:00.000Z`,
        status: n % 2 ? "DEAD_LETTER" : "COMPLETED",
        segregationRef: SCOPE,
      })),
    );

    const plan = await db
      .collection("inbox")
      .find({ status: "DEAD_LETTER" })
      .sort({ eventTime: -1, _id: -1 })
      .limit(21)
      .explain("queryPlanner");

    const winning = JSON.stringify(plan.queryPlanner.winningPlan);

    expect(winning).toContain("IXSCAN");
    // The point of the index: the rows come back in order, so nothing is
    // sorted in memory after the fact.
    expect(winning).not.toContain("SORT");
  });

  it("can be re-applied idempotently", async () => {
    await createStatusIndexes(db);
    await createStatusIndexes(db);

    expect(await indexNames("inbox")).toContain(INBOX_INDEX);
  });

  // The migration exports `up` alone, as every migration in this repo does -
  // there is no `down` to test, and re-running `up` is the only recovery it
  // offers.
  it("exports up and nothing else", async () => {
    const migration = await import(
      "../../migrations/20260908120000-add-status-filtered-list-indexes.js"
    );

    expect(Object.keys(migration)).toEqual(["up"]);
  });
});
