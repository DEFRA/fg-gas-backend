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
  publicationDate: at(n).toISOString(),
  // Runs the other way, so a list that read it would come back reversed.
  eventTime: at(60 - n).toISOString(),
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
    const times = rows.map((r) => r.publicationDate);
    expect(times).toEqual([...times].sort().reverse());
  });

  it("orders by publicationDate, never by the sender's eventTime", async () => {
    await inbox.insertMany(Array.from({ length: 5 }, (_, n) => inboxDoc(n)));

    const { rows } = await walkForward(findInboxPage, { pageSize: 2 });

    expect(rows.map((r) => r.messageId)).toEqual([
      "msg-4",
      "msg-3",
      "msg-2",
      "msg-1",
      "msg-0",
    ]);
  });

  it("never returns more than pageSize rows in a page", async () => {
    await inbox.insertMany(Array.from({ length: 25 }, (_, n) => inboxDoc(n)));

    const { pageSizes } = await walkForward(findInboxPage, { pageSize: 10 });

    expect(pageSizes).toEqual([10, 10, 5]);
    expect(Math.max(...pageSizes)).toBeLessThanOrEqual(10);
  });

  it("reports a next page until the last one, which reports none", async () => {
    await inbox.insertMany(Array.from({ length: 15 }, (_, n) => inboxDoc(n)));

    const first = await findInboxPage({ pageSize: 10 });
    expect(first.pagination.hasNextPage).toBe(true);

    const last = await findInboxPage({
      pageSize: 10,
      cursor: first.pagination.endCursor,
    });
    expect(last.pagination.hasNextPage).toBe(false);
    expect(Object.keys(last.pagination).sort()).toEqual([
      "endCursor",
      "hasNextPage",
    ]);
  });

  it("does not duplicate or skip a row when a newer document is inserted mid-walk", async () => {
    await inbox.insertMany(Array.from({ length: 25 }, (_, n) => inboxDoc(n)));

    const page1 = await findInboxPage({ pageSize: 10 });
    const originalIds = new Set(
      (await inbox.find({}).toArray()).map((d) => d._id.toString()),
    );

    await inbox.insertOne(
      inboxDoc(99, { publicationDate: "2027-01-01T00:00:00.000Z" }),
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
    expect(new Set(walked)).toEqual(originalIds);
  });

  it("does not duplicate or skip a row when an older document is inserted mid-walk", async () => {
    await inbox.insertMany(Array.from({ length: 25 }, (_, n) => inboxDoc(n)));

    const page1 = await findInboxPage({ pageSize: 10 });

    await inbox.insertOne(
      inboxDoc(98, { publicationDate: "2020-01-01T00:00:00.000Z" }),
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

  it("tie-breaks on _id when every publicationDate is identical", async () => {
    const sameTime = "2026-06-16T10:00:00.000Z";
    await inbox.insertMany(
      Array.from({ length: 25 }, (_, n) =>
        inboxDoc(n, { publicationDate: sameTime }),
      ),
    );

    const { rows } = await walkForward(findInboxPage, { pageSize: 10 });

    expect(rows).toHaveLength(25);
    expect(new Set(ids(rows)).size).toBe(25);
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

  // Asserted by identity: the running pollers can move a row's status between
  // the insert and the read.
  it("returns every row when no filter is given", async () => {
    const docs = statuses.map((status, n) => inboxDoc(n, { status }));
    await inbox.insertMany(docs);

    const page = await findInboxPage();

    expect(page.data.map((r) => r.messageId).sort()).toEqual(
      docs.map((d) => d.messageId).sort(),
    );
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
        publicationDate: at(1).toISOString(),
        _id: "not-an-objectid",
      }),
    ).toString("base64url");

    await expect(findInboxPage({ cursor })).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
    });
  });

  // `lastError` is seeded to prove the projection leaves it out.
  it("returns only the generic list fields, never the payload or claim fields", async () => {
    await inbox.insertOne(
      inboxDoc(1, {
        lastError: { name: "Error", message: "boom", at: null },
      }),
    );

    const page = await findInboxPage();

    expect(Object.keys(page.data[0]).sort()).toEqual(
      [
        "_id",
        "completionDate",
        "messageId",
        "publicationDate",
        "status",
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

  // Only DEAD_LETTER is stable here: the running pollers' sweeps move other statuses.
  it("honours the status filter and returns every row when unfiltered", async () => {
    const docs = statuses.map((status, n) => outboxDoc(n, { status }));
    await outbox.insertMany(docs);

    const filtered = await findOutboxPage({ status: "DEAD_LETTER" });
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0].status).toBe("DEAD_LETTER");

    const all = await findOutboxPage();
    expect(all.data.map((r) => r.messageId).sort()).toEqual(
      docs.map((d) => d.messageId).sort(),
    );
  });

  it("rejects a tampered cursor with a Boom 400", async () => {
    await expect(findOutboxPage({ cursor: "tampered" })).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
    });
  });

  // `lastError` is seeded to prove the projection leaves it out.
  it("returns only the generic list fields plus event.id and event.type", async () => {
    await outbox.insertOne(
      outboxDoc(1, {
        lastError: { name: "Error", message: "boom", at: null },
      }),
    );

    const page = await findOutboxPage();

    expect(Object.keys(page.data[0]).sort()).toEqual(
      [
        "_id",
        "completionDate",
        "event",
        "publicationDate",
        "status",
        "target",
      ].sort(),
    );
    expect(page.data[0].event).toEqual({
      id: "evt-1",
      type: "cloud.defra.local.fg-gas-backend.case.create",
    });
    expect(JSON.stringify(page.data)).not.toContain("SECRET-CLIENT-REF");
  });

  it("returns audit rows with nothing of their payload - no entities, no details", async () => {
    await outbox.insertOne(auditOutboxDoc(1));

    const page = await findOutboxPage();

    expect(page.data[0].event).toEqual({});
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
    const audit = page.data.find((r) => !r.event.id);
    expect(audit.event).not.toHaveProperty("id");
    expect(audit.event).not.toHaveProperty("type");
    expect(audit.event).not.toHaveProperty("audit");
  });
});

// Seeds an un-normalised outbox row, proving the mixed-type fault the migration fixes.
describe("sort-key type hazards before the normalising migration", () => {
  it("skips outbox rows whose publicationDate is a string, not a Date", async () => {
    await outbox.insertMany([
      outboxDoc(2, { publicationDate: at(2) }),
      outboxDoc(1, { publicationDate: at(1) }),
      outboxDoc(4, { publicationDate: at(4).toISOString() }),
      outboxDoc(3, { publicationDate: at(3).toISOString() }),
    ]);

    // Mongo orders every Date after every String.
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

    // $lt against a Date never matches a string, so the string rows are unreachable.
    expect(rows.map((r) => r.event.id)).toEqual(["evt-2", "evt-1"]);
    expect(rows).toHaveLength(2);
  });
});

// The leading-key bound beside the keyset `$or` must not change what a walk returns.
describe("deep status-filtered paging", () => {
  const seeded = (n) => ({
    status: n % 3 === 0 ? "DEAD_LETTER" : "COMPLETED",
  });

  it("walks every dead-lettered inbox row once, in the unbounded query's order", async () => {
    await inbox.insertMany(
      Array.from({ length: 60 }, (_, n) => inboxDoc(n, seeded(n))),
    );
    // Ties on the sort key, so the `_id` branch of the keyset is exercised too.
    await inbox.insertMany(
      Array.from({ length: 6 }, (_, n) =>
        inboxDoc(100 + n, {
          status: "DEAD_LETTER",
          publicationDate: at(30).toISOString(),
        }),
      ),
    );

    const { rows, pageSizes } = await walkForward(findInboxPage, {
      status: "DEAD_LETTER",
      pageSize: 4,
    });
    const expected = await inbox
      .find({ status: "DEAD_LETTER" })
      .sort({ publicationDate: -1, _id: -1 })
      .toArray();

    expect(pageSizes.length).toBeGreaterThan(5);
    expect(ids(rows)).toEqual(ids(expected));
  });

  it("walks every dead-lettered outbox row once, in the unbounded query's order", async () => {
    await outbox.insertMany(
      Array.from({ length: 60 }, (_, n) => outboxDoc(n, seeded(n))),
    );

    const { rows, pageSizes } = await walkForward(findOutboxPage, {
      status: "DEAD_LETTER",
      pageSize: 4,
    });
    const expected = await outbox
      .find({ status: "DEAD_LETTER" })
      .sort({ publicationDate: -1, _id: -1 })
      .toArray();

    expect(pageSizes.length).toBeGreaterThan(4);
    expect(ids(rows)).toEqual(ids(expected));
  });
});

describe("cursor encoding against real documents", () => {
  it("encodes the inbox cursor as publicationDate plus a hex _id", async () => {
    await inbox.insertOne(inboxDoc(1));

    const page = await findInboxPage();
    const decoded = JSON.parse(
      Buffer.from(page.pagination.endCursor, "base64url").toString(),
    );

    expect(decoded).toEqual({
      publicationDate: at(1).toISOString(),
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
