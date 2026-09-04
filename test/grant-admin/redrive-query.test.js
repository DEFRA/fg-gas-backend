import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cwStubRequests, resetCwStub, setCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

let client;
let inbox;
let outbox;

const GAS_MAX_ATTEMPTS = 5;

const redriveQuery = (query, headers) =>
  wreck.post(
    `/grant-admin/events/redrive-query?${new URLSearchParams(query)}`,
    headers ? { headers } : {},
  );

const seg = () => `RQ-${new ObjectId().toHexString()}`;

const aDeadInboxDoc = (overrides = {}) => ({
  _id: new ObjectId(),
  messageId: `msg-rq-${new ObjectId().toHexString()}`,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  segregationRef: seg(),
  status: "DEAD_LETTER",
  completionAttempts: GAS_MAX_ATTEMPTS,
  eventTime: "2026-06-16T10:00:00.000Z",
  publicationDate: "2026-06-16T10:00:01.000Z",
  lastResubmissionDate: "2026-06-16T10:05:00.000Z",
  completionDate: null,
  lastError: { name: "TypeError", message: "boom", at: null },
  attemptHistory: [],
  parked: null,
  lastRedrive: null,
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  event: { id: "evt-rq", time: "2026-06-16T10:00:00.000Z", data: {} },
  ...overrides,
});

const insertMany = async (count, overrides) => {
  const docs = Array.from({ length: count }, () => aDeadInboxDoc(overrides));
  await inbox.insertMany(docs);

  return docs;
};

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  inbox = client.db().collection("inbox");
  outbox = client.db().collection("outbox");
});

afterAll(async () => {
  await client?.close();
});

beforeEach(async () => {
  await resetCwStub();
  await inbox.deleteMany({ messageId: /^msg-rq-/ });
});

describe("POST /grant-admin/events/redrive-query", () => {
  it("redrives every dead letter the filter selects", async () => {
    const ref = seg();
    const docs = await insertMany(3, { segregationRef: ref });

    const { payload } = await redriveQuery({ q: ref });

    expect(payload).toMatchObject({
      matched: 3,
      processed: 3,
      redriven: 3,
      conflicts: 0,
      failures: 0,
    });

    for (const doc of docs) {
      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.status).toBe("RESUBMITTED");
      expect(stored.completionAttempts).toBe(0);
    }
  });

  it("touches nothing outside the filter", async () => {
    const ref = seg();
    await insertMany(1, { segregationRef: ref });
    const [other] = await insertMany(1);

    await redriveQuery({ q: ref });

    expect((await inbox.findOne({ _id: other._id })).status).toBe(
      "DEAD_LETTER",
    );
  });

  it("never redrives a row that is not DEAD_LETTER", async () => {
    const ref = seg();
    const [dead] = await insertMany(1, { segregationRef: ref });
    const [completed] = await insertMany(1, {
      segregationRef: ref,
      status: "COMPLETED",
    });

    const { payload } = await redriveQuery({ q: ref });

    expect(payload.matched).toBe(1);
    expect(payload.redriven).toBe(1);
    expect((await inbox.findOne({ _id: completed._id })).status).toBe(
      "COMPLETED",
    );
    expect((await inbox.findOne({ _id: dead._id })).status).toBe("RESUBMITTED");
  });

  it("never redrives a PARKED row", async () => {
    const ref = seg();
    const [doc] = await insertMany(1, { segregationRef: ref });
    await wreck.post(
      `/grant-admin/events/gas/inbox/${doc._id.toHexString()}/park`,
      { payload: { reason: "poison" } },
    );

    const { payload } = await redriveQuery({ q: ref });

    expect(payload.matched).toBe(0);
    expect((await inbox.findOne({ _id: doc._id })).status).toBe("PARKED");
  });

  it("reports matched separately from processed when the limit bites", async () => {
    const ref = seg();
    await insertMany(4, { segregationRef: ref });

    const { payload } = await redriveQuery({ q: ref, limit: 2 });

    expect(payload.matched).toBe(4);
    expect(payload.processed).toBe(2);
    expect(payload.redriven).toBe(2);

    const stillDead = await inbox.countDocuments({
      segregationRef: ref,
      status: "DEAD_LETTER",
    });

    expect(stillDead).toBe(2);
  });

  it("narrows by the error filter as well", async () => {
    const ref = seg();
    await insertMany(2, { segregationRef: ref });
    await insertMany(1, {
      segregationRef: ref,
      lastError: { name: "Error", message: "other", at: null },
    });

    const { payload } = await redriveQuery({ q: ref, error: "boom" });

    expect(payload.matched).toBe(2);
    expect(payload.redriven).toBe(2);
  });

  it("breaks the answer down per source", async () => {
    const ref = seg();
    await insertMany(2, { segregationRef: ref });

    const { payload } = await redriveQuery({ q: ref, service: "gas" });

    expect(payload.perSource.gasInbox).toEqual({
      matched: 2,
      processed: 2,
      redriven: 2,
      conflicts: 0,
      failures: 0,
    });
    expect(payload.perSource.gasOutbox.matched).toBe(0);
  });

  it("persists lastRedrive with the x-actor operator on every row it redrove", async () => {
    const ref = seg();
    const docs = await insertMany(2, { segregationRef: ref });

    await redriveQuery({ q: ref }, { "x-actor": "donatas" });

    for (const doc of docs) {
      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.lastRedrive).toEqual({
        at: expect.any(String),
        by: "donatas",
      });
    }
  });

  it("writes exactly ONE audit event for the whole call, not one per row", async () => {
    const ref = seg();
    await insertMany(3, { segregationRef: ref });

    const before = await outbox.countDocuments({
      "event.audit.entities.action": "REDRIVE_EVENTS",
    });

    await redriveQuery({ q: ref }, { "x-actor": "donatas" });

    const after = await outbox.countDocuments({
      "event.audit.entities.action": "REDRIVE_EVENTS",
    });

    expect(after - before).toBe(1);
  });

  it("records the filter, the actor and the counts on that one audit event", async () => {
    const ref = seg();
    await insertMany(2, { segregationRef: ref });

    await redriveQuery({ q: ref, limit: 10 }, { "x-actor": "donatas" });

    const audit = await outbox.findOne(
      { "event.audit.entities.action": "REDRIVE_EVENTS" },
      { sort: { publicationDate: -1 } },
    );

    expect(audit.event.audit.details).toMatchObject({
      filter: expect.objectContaining({ q: ref, limit: 10 }),
      actor: "donatas",
      matched: 2,
      processed: 2,
      redriven: 2,
    });
  });

  it("takes the filter from a JSON body as well as a query string", async () => {
    const ref = seg();
    await insertMany(2, { segregationRef: ref });

    const { payload } = await wreck.post("/grant-admin/events/redrive-query", {
      payload: { q: ref },
    });

    expect(payload.redriven).toBe(2);
  });

  it("fans out to Caseworking, paging its list endpoint for dead letters", async () => {
    await setCwStub({
      inbox: {
        data: [
          { _id: "665f1c2e9a1b2c3d4e5f6a01" },
          { _id: "665f1c2e9a1b2c3d4e5f6a02" },
        ],
        counts: {
          PUBLISHED: 0,
          PROCESSING: 0,
          FAILED: 0,
          RESUBMITTED: 0,
          COMPLETED: 0,
          DEAD_LETTER: 2,
          PARKED: 0,
        },
        redrive: {
          _id: "665f1c2e9a1b2c3d4e5f6a01",
          eventId: "evt-1",
          type: "cloud.defra.local.fg-cw-backend.case.create",
          source: "CW",
          segregationRef: "GLD-9B2",
          status: "RESUBMITTED",
          completionAttempts: 0,
          maxAttempts: 5,
          traceparent: null,
          createdAt: "2026-06-16T10:00:00.000Z",
          lastFailureAt: null,
          lastError: null,
          completedAt: null,
          parked: null,
          lastRedrive: null,
        },
      },
    });

    const { payload } = await redriveQuery(
      { service: "caseworking" },
      { "x-actor": "donatas" },
    );

    expect(payload.perSource.cwInbox).toMatchObject({
      matched: 2,
      processed: 2,
      redriven: 2,
    });

    const requests = await cwStubRequests();
    const listed = requests.find((r) => r.path === "/actuators/inbox");

    expect(listed.query.status).toBe("DEAD_LETTER");
    expect(
      requests
        .filter((r) => r.path.endsWith("/redrive"))
        .every((r) => r.query.by === "donatas"),
    ).toBe(true);
  });

  it("degrades with a sourceError when Caseworking is unreachable", async () => {
    const ref = seg();
    await insertMany(1, { segregationRef: ref });
    await setCwStub({ inbox: { mode: "error" }, outbox: { mode: "error" } });

    const { payload } = await redriveQuery({ q: ref });

    expect(payload.redriven).toBe(1);
    expect(payload.sourceErrors).toEqual([
      { service: "caseworking", box: "inbox", message: "HTTP 500" },
      { service: "caseworking", box: "outbox", message: "HTTP 500" },
    ]);
  });

  it("counts a Caseworking 409 as a conflict rather than a failure", async () => {
    await setCwStub({
      inbox: {
        data: [{ _id: "665f1c2e9a1b2c3d4e5f6a01" }],
        counts: {
          PUBLISHED: 0,
          PROCESSING: 0,
          FAILED: 0,
          RESUBMITTED: 0,
          COMPLETED: 0,
          DEAD_LETTER: 1,
          PARKED: 0,
        },
        redriveConflictStatus: "COMPLETED",
      },
    });

    const { payload } = await redriveQuery({ service: "caseworking" });

    expect(payload.conflicts).toBe(1);
    expect(payload.failures).toBe(0);
  });

  it("answers with zeros when nothing matched", async () => {
    const { payload } = await redriveQuery({ q: seg() });

    expect(payload).toMatchObject({
      matched: 0,
      processed: 0,
      redriven: 0,
      conflicts: 0,
      failures: 0,
    });
  });

  it("rejects a status with 400 - the scope is implicitly DEAD_LETTER", async () => {
    await expect(redriveQuery({ status: "PUBLISHED" })).rejects.toThrow(
      "Response Error: 400 Bad Request",
    );
  });

  it("rejects a limit over 500 with 400", async () => {
    await expect(redriveQuery({ limit: 501 })).rejects.toThrow(
      "Response Error: 400 Bad Request",
    );
  });

  it("rejects an over-long x-actor header with 400", async () => {
    await expect(
      redriveQuery({ q: seg() }, { "x-actor": "x".repeat(129) }),
    ).rejects.toThrow("Response Error: 400 Bad Request");
  });

  it("reaches the bulk redrive route rather than the per-id one", async () => {
    const { payload } = await redriveQuery({ q: seg() });

    expect(payload).toHaveProperty("perSource");
  });
});
