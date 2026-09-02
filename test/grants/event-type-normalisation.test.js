import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { up as normaliseSortKeys } from "../../migrations/20260901130000-normalise-event-sort-keys.js";
import { findPage as findInboxPage } from "../../src/grants/repositories/inbox.repository.js";
import { findPage as findOutboxPage } from "../../src/grants/repositories/outbox.repository.js";

let client;
let db;
let inbox;
let outbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db();
  inbox = db.collection("inbox");
  outbox = db.collection("outbox");
});

afterAll(async () => {
  await client?.close();
});

const walkForward = async (findPage, pageSize) => {
  const rows = [];
  let cursor;
  let hasNextPage = true;
  let guard = 0;

  while (hasNextPage && guard < 50) {
    const page = await findPage({ pageSize, cursor });
    rows.push(...page.data);
    cursor = page.pagination.endCursor;
    hasNextPage = page.pagination.hasNextPage;
    guard++;
  }

  return rows;
};

const outboxSeed = (overrides) => ({
  target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case_fifo",
  status: "PUBLISHED",
  completionAttempts: 1,
  segregationRef: "ref",
  event: { id: "evt", type: "cloud.defra.local.fg-gas-backend.case.create" },
  ...overrides,
});

const inboxSeed = (overrides) => ({
  messageId: "msg",
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  status: "PUBLISHED",
  completionAttempts: 1,
  segregationRef: "ref",
  ...overrides,
});

// A mixed outbox: a proper Date, a parsable ISO string, and a string no date
// parser can make sense of.
const seedMixedOutbox = async () => {
  await outbox.insertMany([
    outboxSeed({
      publicationDate: new Date("2026-06-16T10:02:00.000Z"),
      segregationRef: "date-row",
    }),
    outboxSeed({
      publicationDate: "2026-06-16T10:01:00.000Z",
      segregationRef: "parsable-string-row",
    }),
    outboxSeed({
      publicationDate: "not-a-date-at-all",
      segregationRef: "unparsable-string-row",
    }),
  ]);
};

// A mixed inbox: a proper ISO string, an explicit null with a usable
// event.time, a missing field with a usable event.time, and a missing field
// with nothing to fall back on but the _id.
const seedMixedInbox = async () => {
  await inbox.insertMany([
    inboxSeed({
      eventTime: "2026-06-16T10:03:00.000Z",
      event: { time: "2026-06-16T10:03:00.000Z" },
      segregationRef: "string-row",
    }),
    inboxSeed({
      eventTime: null,
      event: { time: "2026-06-16T10:02:00.000Z" },
      segregationRef: "null-with-event-time",
    }),
    inboxSeed({
      event: { time: "2026-06-16T10:01:00.000Z" },
      segregationRef: "missing-with-event-time",
    }),
    inboxSeed({
      event: { data: { clientRef: "no-time-here" } },
      segregationRef: "missing-without-event-time",
    }),
    inboxSeed({
      eventTime: null,
      event: { time: "" },
      segregationRef: "null-with-empty-event-time",
    }),
  ]);
};

const bySegregationRef = (rows) =>
  Object.fromEntries(rows.map((r) => [r.segregationRef, r]));

describe("normalising the event sort keys", () => {
  describe("outbox.publicationDate", () => {
    it("leaves no string publicationDate behind", async () => {
      await seedMixedOutbox();

      await normaliseSortKeys(db);

      expect(
        await outbox.countDocuments({ publicationDate: { $type: "string" } }),
      ).toBe(0);
      expect(
        await outbox.countDocuments({
          publicationDate: { $not: { $type: "date" } },
        }),
      ).toBe(0);
    });

    it("converts a parsable string to the equivalent Date and leaves a real Date alone", async () => {
      await seedMixedOutbox();

      await normaliseSortKeys(db);

      const rows = bySegregationRef(await outbox.find({}).toArray());
      expect(rows["parsable-string-row"].publicationDate).toEqual(
        new Date("2026-06-16T10:01:00.000Z"),
      );
      expect(rows["date-row"].publicationDate).toEqual(
        new Date("2026-06-16T10:02:00.000Z"),
      );
    });

    it("falls back to the ObjectId timestamp for an unparsable string", async () => {
      await seedMixedOutbox();

      await normaliseSortKeys(db);

      const row = await outbox.findOne({
        segregationRef: "unparsable-string-row",
      });
      expect(row.publicationDate).toBeInstanceOf(Date);
      expect(row.publicationDate).toEqual(row._id.getTimestamp());
    });

    it("returns every row from a full forward walk once normalised", async () => {
      await seedMixedOutbox();
      await normaliseSortKeys(db);

      const rows = await walkForward(findOutboxPage, 2);

      // Before the migration this walk stopped inside the Date block and
      // returned only 1 of the 3 rows - see the "before the normalising
      // migration" block in event-pagination.test.js.
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.segregationRef).sort()).toEqual([
        "date-row",
        "parsable-string-row",
        "unparsable-string-row",
      ]);
    });
  });

  describe("inbox.eventTime", () => {
    it("leaves every eventTime as a string", async () => {
      await seedMixedInbox();

      await normaliseSortKeys(db);

      expect(
        await inbox.countDocuments({
          eventTime: { $not: { $type: "string" } },
        }),
      ).toBe(0);
    });

    it("backfills from event.time when it is a usable string", async () => {
      await seedMixedInbox();

      await normaliseSortKeys(db);

      const rows = bySegregationRef(await inbox.find({}).toArray());
      expect(rows["null-with-event-time"].eventTime).toBe(
        "2026-06-16T10:02:00.000Z",
      );
      expect(rows["missing-with-event-time"].eventTime).toBe(
        "2026-06-16T10:01:00.000Z",
      );
      // An already-good row is left exactly as it was.
      expect(rows["string-row"].eventTime).toBe("2026-06-16T10:03:00.000Z");
    });

    it("falls back to the ObjectId timestamp when event.time is missing or empty", async () => {
      await seedMixedInbox();

      await normaliseSortKeys(db);

      const rows = bySegregationRef(await inbox.find({}).toArray());

      for (const ref of [
        "missing-without-event-time",
        "null-with-empty-event-time",
      ]) {
        const row = rows[ref];
        expect(typeof row.eventTime).toBe("string");
        // ObjectId timestamps have second precision; the ISO string must round
        // trip back to exactly that instant.
        expect(new Date(row.eventTime)).toEqual(row._id.getTimestamp());
      }
    });

    it("returns every row from a full forward walk once normalised", async () => {
      await seedMixedInbox();
      await normaliseSortKeys(db);

      const rows = await walkForward(findInboxPage, 2);

      // Before the migration the null and missing rows were unreachable.
      expect(rows).toHaveLength(5);
      expect(new Set(rows.map((r) => r._id.toString())).size).toBe(5);
    });
  });

  describe("idempotency", () => {
    it("changes nothing on a second run", async () => {
      await seedMixedOutbox();
      await seedMixedInbox();

      await normaliseSortKeys(db);

      const outboxAfterFirst = await outbox.find({}).sort({ _id: 1 }).toArray();
      const inboxAfterFirst = await inbox.find({}).sort({ _id: 1 }).toArray();

      await normaliseSortKeys(db);

      expect(await outbox.find({}).sort({ _id: 1 }).toArray()).toEqual(
        outboxAfterFirst,
      );
      expect(await inbox.find({}).sort({ _id: 1 }).toArray()).toEqual(
        inboxAfterFirst,
      );
    });

    it("is safe to run against collections that are already clean", async () => {
      await outbox.insertOne(
        outboxSeed({ publicationDate: new Date("2026-06-16T10:00:00.000Z") }),
      );
      await inbox.insertOne(
        inboxSeed({ eventTime: "2026-06-16T10:00:00.000Z" }),
      );

      await normaliseSortKeys(db);

      expect(
        await outbox.countDocuments({ publicationDate: { $type: "string" } }),
      ).toBe(0);
      expect(
        await inbox.countDocuments({
          eventTime: { $not: { $type: "string" } },
        }),
      ).toBe(0);
    });
  });
});
