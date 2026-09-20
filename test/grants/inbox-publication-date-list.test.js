import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { up as moveInboxListOntoReceipt } from "../../migrations/20260914120000-inbox-publication-date-list-indexes.js";
import { findPage as findInboxPage } from "../../src/grants/repositories/inbox.repository.js";

const LIST_INDEX = "publicationDate_-1__id_-1";
const STATUS_INDEX = "status_1_publicationDate_-1__id_-1";
const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let client;
let db;
let inbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db();
  inbox = db.collection("inbox");
});

afterAll(async () => {
  await moveInboxListOntoReceipt(db);
  await client?.close();
});

const idAt = (iso) =>
  ObjectId.createFromTime(Math.floor(Date.parse(iso) / 1000));

// COMPLETED, so the running poller never re-saves the values under test.
const seed = (segregationRef, overrides = {}) => ({
  _id: idAt("2026-06-16T09:00:00.000Z"),
  messageId: `msg-${segregationRef}`,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  status: "COMPLETED",
  completionAttempts: 1,
  eventTime: "2026-06-16T08:00:00.000Z",
  segregationRef,
  ...overrides,
});

const seedMixed = async () => {
  await inbox.insertMany([
    seed("canonical", {
      _id: new ObjectId(),
      publicationDate: "2026-06-16T10:05:00.123Z",
    }),
    seed("date", {
      _id: new ObjectId(),
      publicationDate: new Date("2026-06-16T10:04:00.456Z"),
    }),
    seed("offset", {
      _id: new ObjectId(),
      publicationDate: "2026-06-16T11:03:00+01:00",
    }),
    seed("null", {
      _id: idAt("2026-06-16T10:02:00.000Z"),
      publicationDate: null,
    }),
    seed("missing", { _id: idAt("2026-06-16T10:01:00.000Z") }),
    seed("unparsable", {
      _id: idAt("2026-06-16T10:00:00.000Z"),
      publicationDate: "not-an-instant",
    }),
  ]);
};

const byRef = async () =>
  Object.fromEntries(
    (await inbox.find({}).toArray()).map((r) => [r.segregationRef, r]),
  );

const walkForward = async (opts = {}) => {
  const rows = [];
  let cursor;
  let hasNextPage = true;
  let guard = 0;

  while (hasNextPage && guard < 50) {
    const page = await findInboxPage({ ...opts, cursor });
    rows.push(...page.data);
    cursor = page.pagination.endCursor;
    hasNextPage = page.pagination.hasNextPage;
    guard++;
  }

  return rows;
};

describe("normalising inbox publicationDate", () => {
  it("leaves every row holding a canonical ISO string", async () => {
    await seedMixed();

    await moveInboxListOntoReceipt(db);

    const rows = await inbox.find({}).toArray();
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.publicationDate).toMatch(CANONICAL_ISO);
    }
  });

  it("keeps the instant of a Date and of an offset-bearing string", async () => {
    await seedMixed();

    await moveInboxListOntoReceipt(db);

    const rows = await byRef();
    expect(rows.date.publicationDate).toBe("2026-06-16T10:04:00.456Z");
    expect(rows.offset.publicationDate).toBe("2026-06-16T10:03:00.000Z");
    expect(rows.canonical.publicationDate).toBe("2026-06-16T10:05:00.123Z");
  });

  it("falls back to the insert instant where there is no readable receipt", async () => {
    await seedMixed();

    await moveInboxListOntoReceipt(db);

    const rows = await byRef();
    expect(rows.null.publicationDate).toBe("2026-06-16T10:02:00.000Z");
    expect(rows.missing.publicationDate).toBe("2026-06-16T10:01:00.000Z");
    expect(rows.unparsable.publicationDate).toBe("2026-06-16T10:00:00.000Z");
  });

  it("never touches eventTime", async () => {
    await seedMixed();

    await moveInboxListOntoReceipt(db);

    expect(
      await inbox.countDocuments({ eventTime: "2026-06-16T08:00:00.000Z" }),
    ).toBe(6);
  });

  it("lets one keyset walk reach every row, newest receipt first", async () => {
    await seedMixed();
    await moveInboxListOntoReceipt(db);

    const rows = await walkForward({ pageSize: 2 });

    expect(rows.map((r) => r.messageId)).toEqual([
      "msg-canonical",
      "msg-date",
      "msg-offset",
      "msg-null",
      "msg-missing",
      "msg-unparsable",
    ]);
  });

  it("changes nothing on a second run", async () => {
    await seedMixed();

    await moveInboxListOntoReceipt(db);
    const once = await inbox.find({}).sort({ _id: 1 }).toArray();
    await moveInboxListOntoReceipt(db);

    expect(await inbox.find({}).sort({ _id: 1 }).toArray()).toEqual(once);
  });

  it("exports up and nothing else", async () => {
    const migration =
      await import("../../migrations/20260914120000-inbox-publication-date-list-indexes.js");

    expect(Object.keys(migration)).toEqual(["up"]);
  });
});

describe("the inbox list by publicationDate", () => {
  const seedRows = async () => {
    await inbox.insertMany(
      Array.from({ length: 6 }, (_, n) =>
        seed(`row-${n}`, {
          _id: new ObjectId(),
          status: n % 2 ? "DEAD_LETTER" : "COMPLETED",
          publicationDate: `2026-06-16T10:0${n}:00.000Z`,
          eventTime: `2026-06-16T09:0${9 - n}:00.000Z`,
        }),
      ),
    );
  };

  const indexKey = async (name) =>
    (await inbox.indexes()).find((i) => i.name === name)?.key;

  it("has both list indexes after the service boots", async () => {
    expect(await indexKey(LIST_INDEX)).toEqual({
      publicationDate: -1,
      _id: -1,
    });
    expect(await indexKey(STATUS_INDEX)).toEqual({
      status: 1,
      publicationDate: -1,
      _id: -1,
    });
  });

  it("drops the unused eventTime list index and keeps the poller's", async () => {
    await inbox.createIndex({ eventTime: -1, _id: -1 });

    await moveInboxListOntoReceipt(db);
    await moveInboxListOntoReceipt(db);

    expect(await indexKey("eventTime_-1__id_-1")).toBeUndefined();
    expect(await indexKey("status_1_eventTime_-1__id_-1")).toEqual({
      status: 1,
      eventTime: -1,
      _id: -1,
    });
  });

  // The claim query's sort would otherwise be an in-memory SORT over the backlog.
  it("serves the poller's claim query from the status and eventTime index", async () => {
    await seedRows();

    const plan = await inbox
      .find({
        status: { $eq: "PUBLISHED" },
        claimedBy: { $eq: null },
        completionAttempts: { $lt: 5 },
        segregationRef: "row-1",
      })
      .sort({ eventTime: 1 })
      .limit(1)
      .explain("queryPlanner");

    const winning = JSON.stringify(plan.queryPlanner.winningPlan);
    expect(winning).toContain("status_1_eventTime_-1__id_-1");
    expect(winning).not.toContain("SORT");
  });

  it.each([
    ["an unfiltered page", {}],
    ["a status-filtered page", { status: "DEAD_LETTER" }],
  ])("serves %s as an ordered index scan", async (_name, filter) => {
    await seedRows();

    const plan = await inbox
      .find(filter)
      .sort({ publicationDate: -1, _id: -1 })
      .limit(21)
      .explain("queryPlanner");

    const winning = JSON.stringify(plan.queryPlanner.winningPlan);
    expect(winning).toContain("IXSCAN");
    expect(winning).not.toContain("SORT");
  });

  it("filters the time range on publicationDate, not eventTime", async () => {
    await seedRows();

    const page = await findInboxPage({
      from: "2026-06-16T10:02:00.000Z",
      to: "2026-06-16T10:03:00.000Z",
    });

    expect(page.data.map((r) => r.messageId)).toEqual([
      "msg-row-3",
      "msg-row-2",
    ]);
  });

  it("canonicalises an offset-bearing bound to the stored spelling", async () => {
    await seedRows();

    const page = await findInboxPage({ from: "2026-06-16T11:04:00+01:00" });

    expect(page.data.map((r) => r.messageId)).toEqual([
      "msg-row-5",
      "msg-row-4",
    ]);
  });

  it("pages a status-filtered list by publicationDate", async () => {
    await seedRows();

    const rows = await walkForward({ status: "DEAD_LETTER", pageSize: 1 });

    expect(rows.map((r) => r.messageId)).toEqual([
      "msg-row-5",
      "msg-row-3",
      "msg-row-1",
    ]);
  });
});
