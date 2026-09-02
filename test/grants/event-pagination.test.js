import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findPage as findInboxPage } from "../../src/grants/repositories/inbox.repository.js";
import { findPage as findOutboxPage } from "../../src/grants/repositories/outbox.repository.js";

let client;
let inbox;
let outbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  inbox = client.db().collection("inbox");
  outbox = client.db().collection("outbox");
});

afterAll(async () => {
  await client?.close();
});

const statuses = [
  "PUBLISHED",
  "PROCESSING",
  "FAILED",
  "RESUBMITTED",
  "COMPLETED",
  "DEAD_LETTER",
];

const at = (n) => new Date(Date.UTC(2026, 5, 16, 10, n));

const inboxDoc = (n, overrides = {}) => ({
  messageId: `msg-${n}`,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  status: "PUBLISHED",
  completionAttempts: 1,
  eventTime: at(n).toISOString(),
  // Deliberately present so the projection has something to exclude.
  publicationDate: new Date().toISOString(),
  traceparent: "00-trace-parent-01",
  lastResubmissionDate: null,
  completionDate: null,
  segregationRef: `ref-${n}`,
  event: {
    id: `evt-${n}`,
    time: at(n).toISOString(),
    data: { clientRef: "SECRET-CLIENT-REF", sbi: "123456789" },
  },
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  ...overrides,
});

const outboxDoc = (n, overrides = {}) => ({
  target:
    "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case_fifo.fifo",
  status: "PUBLISHED",
  completionAttempts: 1,
  publicationDate: at(n),
  lastResubmissionDate: null,
  completionDate: null,
  segregationRef: `ref-${n}`,
  event: {
    id: `evt-${n}`,
    type: "cloud.defra.local.fg-gas-backend.case.create",
    time: at(n).toISOString(),
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    data: { clientRef: "SECRET-CLIENT-REF", sbi: "123456789" },
  },
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  ...overrides,
});

const auditOutboxDoc = (n) =>
  outboxDoc(n, {
    target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn",
    event: {
      audit: {
        entities: [
          {
            entity: "APPLICATION",
            action: "CREATE",
            entityid: "SECRET-AGREEMENT-NUMBER",
          },
        ],
        status: "success",
        accounts: [],
        details: { secret: "SECRET-AUDIT-DETAILS" },
      },
      datetime: at(n).toISOString(),
      correlationid: "corr-1",
      component: "fg-gas-backend",
      environment: "local",
    },
  });

// Walks every forward page, returning the rows and the per-page sizes.
const walkForward = async (findPage, opts = {}) => {
  const rows = [];
  const pageSizes = [];
  let cursor;
  let hasNextPage = true;
  let guard = 0;

  while (hasNextPage && guard < 50) {
    const page = await findPage({ ...opts, cursor });
    rows.push(...page.data);
    pageSizes.push(page.data.length);
    cursor = page.pagination.endCursor;
    hasNextPage = page.pagination.hasNextPage;
    guard++;
  }

  return { rows, pageSizes };
};

const ids = (rows) => rows.map((r) => r._id.toString());

describe("inbox keyset pagination", () => {
  it("pages forward through every document exactly once, newest first", async () => {
    await inbox.insertMany(Array.from({ length: 25 }, (_, n) => inboxDoc(n)));

    const { rows } = await walkForward(findInboxPage, { pageSize: 10 });

    expect(rows).toHaveLength(25);
    expect(new Set(ids(rows)).size).toBe(25);
    const times = rows.map((r) => r.eventTime);
    expect(times).toEqual([...times].sort().reverse());
  });

  it("never returns more than pageSize rows in a page", async () => {
    await inbox.insertMany(Array.from({ length: 25 }, (_, n) => inboxDoc(n)));

    const { pageSizes } = await walkForward(findInboxPage, { pageSize: 10 });

    expect(pageSizes).toEqual([10, 10, 5]);
    expect(Math.max(...pageSizes)).toBeLessThanOrEqual(10);
  });

  it("reports no previous page on the first page and no next page on the last", async () => {
    await inbox.insertMany(Array.from({ length: 15 }, (_, n) => inboxDoc(n)));

    const first = await findInboxPage({ pageSize: 10 });
    expect(first.pagination.hasPreviousPage).toBe(false);
    expect(first.pagination.hasNextPage).toBe(true);

    const last = await findInboxPage({
      pageSize: 10,
      cursor: first.pagination.endCursor,
    });
    expect(last.pagination.hasNextPage).toBe(false);
    expect(last.pagination.hasPreviousPage).toBe(true);
  });

  it("pages backward to the identical previous page", async () => {
    await inbox.insertMany(Array.from({ length: 25 }, (_, n) => inboxDoc(n)));

    const page1 = await findInboxPage({ pageSize: 10 });
    const page2 = await findInboxPage({
      pageSize: 10,
      cursor: page1.pagination.endCursor,
    });
    const page3 = await findInboxPage({
      pageSize: 10,
      cursor: page2.pagination.endCursor,
    });

    const back = await findInboxPage({
      pageSize: 10,
      cursor: page3.pagination.startCursor,
      direction: "backward",
    });

    expect(ids(back.data)).toEqual(ids(page2.data));
  });

  it("returns to the first page when paging backward twice", async () => {
    await inbox.insertMany(Array.from({ length: 25 }, (_, n) => inboxDoc(n)));

    const page1 = await findInboxPage({ pageSize: 10 });
    const page2 = await findInboxPage({
      pageSize: 10,
      cursor: page1.pagination.endCursor,
    });
    const back = await findInboxPage({
      pageSize: 10,
      cursor: page2.pagination.startCursor,
      direction: "backward",
    });

    expect(ids(back.data)).toEqual(ids(page1.data));
  });

  it("does not duplicate or skip a row when a newer document is inserted mid-walk", async () => {
    await inbox.insertMany(Array.from({ length: 25 }, (_, n) => inboxDoc(n)));

    const page1 = await findInboxPage({ pageSize: 10 });
    const originalIds = new Set(
      (await inbox.find({}).toArray()).map((d) => d._id.toString()),
    );

    // A brand new event lands at the head of the stream, before page 1.
    await inbox.insertOne(
      inboxDoc(99, { eventTime: "2027-01-01T00:00:00.000Z" }),
    );

    const rest = [];
    let cursor = page1.pagination.endCursor;
    let hasNextPage = page1.pagination.hasNextPage;
    while (hasNextPage) {
      const page = await findInboxPage({ pageSize: 10, cursor });
      rest.push(...page.data);
      cursor = page.pagination.endCursor;
      hasNextPage = page.pagination.hasNextPage;
    }

    const walked = ids([...page1.data, ...rest]);
    expect(new Set(walked).size).toBe(walked.length);
    expect(walked).toHaveLength(25);
    // Every pre-existing row was seen exactly once; the late arrival is simply
    // not back-filled into a page already served.
    expect(new Set(walked)).toEqual(originalIds);
  });

  it("does not duplicate or skip a row when an older document is inserted mid-walk", async () => {
    await inbox.insertMany(Array.from({ length: 25 }, (_, n) => inboxDoc(n)));

    const page1 = await findInboxPage({ pageSize: 10 });

    // Older than everything seeded, so it belongs on the final page.
    await inbox.insertOne(
      inboxDoc(98, { eventTime: "2020-01-01T00:00:00.000Z" }),
    );

    const rest = [];
    let cursor = page1.pagination.endCursor;
    let hasNextPage = page1.pagination.hasNextPage;
    while (hasNextPage) {
      const page = await findInboxPage({ pageSize: 10, cursor });
      rest.push(...page.data);
      cursor = page.pagination.endCursor;
      hasNextPage = page.pagination.hasNextPage;
    }

    const walked = ids([...page1.data, ...rest]);
    expect(new Set(walked).size).toBe(walked.length);
    expect(walked).toHaveLength(26);
    expect(walked.at(-1)).toBe(
      (await inbox.findOne({ messageId: "msg-98" }))._id.toString(),
    );
  });

  it("tie-breaks on _id when every eventTime is identical", async () => {
    const sameTime = "2026-06-16T10:00:00.000Z";
    await inbox.insertMany(
      Array.from({ length: 25 }, (_, n) =>
        inboxDoc(n, { eventTime: sameTime }),
      ),
    );

    const { rows } = await walkForward(findInboxPage, { pageSize: 10 });

    expect(rows).toHaveLength(25);
    expect(new Set(ids(rows)).size).toBe(25);
    // Deterministic order: _id descending, as the tie-breaker demands.
    const rowIds = ids(rows);
    expect(rowIds).toEqual([...rowIds].sort().reverse());
  });

  it("honours the status filter", async () => {
    await inbox.insertMany(
      statuses.map((status, n) => inboxDoc(n, { status })),
    );

    const page = await findInboxPage({ status: "DEAD_LETTER" });

    expect(page.data).toHaveLength(1);
    expect(page.data[0].status).toBe("DEAD_LETTER");
  });

  it("returns every status when no filter is given", async () => {
    await inbox.insertMany(
      statuses.map((status, n) => inboxDoc(n, { status })),
    );

    const page = await findInboxPage();

    expect(page.data.map((r) => r.status).sort()).toEqual([...statuses].sort());
  });

  it("accepts a cursor issued under a different filter", async () => {
    await inbox.insertMany(
      Array.from({ length: 10 }, (_, n) =>
        inboxDoc(n, { status: n % 2 === 0 ? "COMPLETED" : "DEAD_LETTER" }),
      ),
    );

    const unfiltered = await findInboxPage({ pageSize: 4 });
    const filtered = await findInboxPage({
      pageSize: 4,
      cursor: unfiltered.pagination.endCursor,
      status: "DEAD_LETTER",
    });

    // A cursor is only a keyset position, so it stays usable under any filter.
    expect(filtered.data.every((r) => r.status === "DEAD_LETTER")).toBe(true);
  });

  it("rejects a tampered cursor with a Boom 400", async () => {
    await expect(findInboxPage({ cursor: "tampered" })).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
    });
  });

  it("rejects a well-formed cursor carrying a non-hex _id with a Boom 400", async () => {
    const cursor = Buffer.from(
      JSON.stringify({
        eventTime: at(1).toISOString(),
        _id: "not-an-objectid",
      }),
    ).toString("base64url");

    await expect(findInboxPage({ cursor })).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
    });
  });

  it("returns only the generic list fields, never the payload or claim fields", async () => {
    await inbox.insertOne(inboxDoc(1));

    const page = await findInboxPage();

    expect(Object.keys(page.data[0]).sort()).toEqual(
      [
        "_id",
        "completionAttempts",
        "completionDate",
        "eventTime",
        "lastResubmissionDate",
        "messageId",
        "segregationRef",
        "source",
        "status",
        "traceparent",
        "type",
      ].sort(),
    );
    expect(JSON.stringify(page.data)).not.toContain("SECRET-CLIENT-REF");
  });
});

describe("outbox keyset pagination", () => {
  it("pages forward through every document exactly once, newest first", async () => {
    await outbox.insertMany(Array.from({ length: 25 }, (_, n) => outboxDoc(n)));

    const { rows } = await walkForward(findOutboxPage, { pageSize: 10 });

    expect(rows).toHaveLength(25);
    expect(new Set(ids(rows)).size).toBe(25);
    const times = rows.map((r) => r.publicationDate.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("pages backward to the identical previous page", async () => {
    await outbox.insertMany(Array.from({ length: 25 }, (_, n) => outboxDoc(n)));

    const page1 = await findOutboxPage({ pageSize: 10 });
    const page2 = await findOutboxPage({
      pageSize: 10,
      cursor: page1.pagination.endCursor,
    });
    const back = await findOutboxPage({
      pageSize: 10,
      cursor: page2.pagination.startCursor,
      direction: "backward",
    });

    expect(ids(back.data)).toEqual(ids(page1.data));
  });

  it("tie-breaks on _id when every publicationDate is identical", async () => {
    await outbox.insertMany(
      Array.from({ length: 25 }, (_, n) =>
        outboxDoc(n, { publicationDate: at(0) }),
      ),
    );

    const { rows } = await walkForward(findOutboxPage, { pageSize: 10 });

    expect(rows).toHaveLength(25);
    const rowIds = ids(rows);
    expect(rowIds).toEqual([...rowIds].sort().reverse());
  });

  it("honours the status filter and returns every status when unfiltered", async () => {
    await outbox.insertMany(
      statuses.map((status, n) => outboxDoc(n, { status })),
    );

    const filtered = await findOutboxPage({ status: "FAILED" });
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0].status).toBe("FAILED");

    const all = await findOutboxPage();
    expect(all.data.map((r) => r.status).sort()).toEqual([...statuses].sort());
  });

  it("rejects a tampered cursor with a Boom 400", async () => {
    await expect(findOutboxPage({ cursor: "tampered" })).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
    });
  });

  it("returns only the generic list fields plus event.id and event.type", async () => {
    await outbox.insertOne(outboxDoc(1));

    const page = await findOutboxPage();

    expect(Object.keys(page.data[0]).sort()).toEqual(
      [
        "_id",
        "completionAttempts",
        "completionDate",
        "event",
        "lastResubmissionDate",
        "publicationDate",
        "segregationRef",
        "status",
        "target",
      ].sort(),
    );
    expect(page.data[0].event).toEqual({
      id: "evt-1",
      type: "cloud.defra.local.fg-gas-backend.case.create",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    });
    expect(JSON.stringify(page.data)).not.toContain("SECRET-CLIENT-REF");
  });

  it("returns audit rows with only entity and action, never entityid or details", async () => {
    await outbox.insertOne(auditOutboxDoc(1));

    const page = await findOutboxPage();

    expect(page.data[0].event).toEqual({
      audit: { entities: [{ entity: "APPLICATION", action: "CREATE" }] },
    });
    const serialised = JSON.stringify(page.data);
    expect(serialised).not.toContain("SECRET-AGREEMENT-NUMBER");
    expect(serialised).not.toContain("SECRET-AUDIT-DETAILS");
    expect(serialised).not.toContain("entityid");
    expect(serialised).not.toContain("details");
  });

  it("lists audit rows alongside domain rows with no id or type of their own", async () => {
    await outbox.insertMany([outboxDoc(1), auditOutboxDoc(2)]);

    const page = await findOutboxPage();

    expect(page.data).toHaveLength(2);
    const audit = page.data.find((r) => r.event.audit);
    expect(audit.event).not.toHaveProperty("id");
    expect(audit.event).not.toHaveProperty("type");
  });
});

// These tests pin down the mixed-type fault on *un-normalised* data. They seed
// bad rows directly and never invoke the migration, so they prove the fault is
// real and that it is the migration - not something else - that fixes it. The
// mirror-image "once normalised, every row is returned" cases live in
// test/grants/event-type-normalisation.test.js. Keep the two in step.
describe("sort-key type hazards before the normalising migration", () => {
  it("skips outbox rows whose publicationDate is a string, not a Date", async () => {
    await outbox.insertMany([
      outboxDoc(2, { publicationDate: at(2) }),
      outboxDoc(1, { publicationDate: at(1) }),
      outboxDoc(4, { publicationDate: at(4).toISOString() }),
      outboxDoc(3, { publicationDate: at(3).toISOString() }),
    ]);

    // Mongo's canonical type order puts every Date after every String, so a
    // descending sort yields the Dates first and the strings last.
    const raw = await outbox
      .find({})
      .sort({ publicationDate: -1, _id: -1 })
      .toArray();
    expect(raw.map((d) => d.segregationRef)).toEqual([
      "ref-2",
      "ref-1",
      "ref-4",
      "ref-3",
    ]);

    const { rows } = await walkForward(findOutboxPage, { pageSize: 2 });

    // $lt against a Date is type-bracketed and never matches a string, so the
    // walk stops at the end of the Date block: the string rows are unreachable.
    expect(rows.map((r) => r.segregationRef)).toEqual(["ref-2", "ref-1"]);
    expect(rows).toHaveLength(2);
  });

  it("skips inbox rows whose eventTime is null or missing", async () => {
    await inbox.insertMany([
      inboxDoc(2),
      inboxDoc(1),
      inboxDoc(0, { eventTime: null, segregationRef: "ref-null" }),
      { status: "PUBLISHED", segregationRef: "ref-missing", messageId: "m" },
    ]);

    const { rows } = await walkForward(findInboxPage, { pageSize: 2 });

    // Null and missing sort last under {eventTime: -1}, but $lt against a
    // string never matches them, so a keyset walk finishes at the string block.
    expect(rows.map((r) => r.segregationRef)).toEqual(["ref-2", "ref-1"]);
  });

  it("pages through null eventTime rows when no string-valued row precedes them", async () => {
    await inbox.insertMany([
      inboxDoc(0, { eventTime: null, segregationRef: "ref-null-a" }),
      inboxDoc(1, { eventTime: null, segregationRef: "ref-null-b" }),
      inboxDoc(2, { eventTime: null, segregationRef: "ref-null-c" }),
    ]);

    const { rows } = await walkForward(findInboxPage, { pageSize: 2 });

    // Inside a single null block the _id tie-breaker carries the walk, so all
    // three rows are returned exactly once.
    expect(rows).toHaveLength(3);
    expect(new Set(ids(rows)).size).toBe(3);
  });
});

describe("cursor encoding against real documents", () => {
  it("encodes the inbox cursor as eventTime plus a hex _id", async () => {
    await inbox.insertOne(inboxDoc(1));

    const page = await findInboxPage();
    const decoded = JSON.parse(
      Buffer.from(page.pagination.endCursor, "base64url").toString(),
    );

    expect(decoded).toEqual({
      eventTime: at(1).toISOString(),
      _id: page.data[0]._id.toString(),
    });
    expect(ObjectId.isValid(decoded._id)).toBe(true);
  });

  it("encodes the outbox cursor with publicationDate as an ISO string", async () => {
    await outbox.insertOne(outboxDoc(1));

    const page = await findOutboxPage();
    const decoded = JSON.parse(
      Buffer.from(page.pagination.endCursor, "base64url").toString(),
    );

    expect(decoded).toEqual({
      publicationDate: at(1).toISOString(),
      _id: page.data[0]._id.toString(),
    });
  });
});
