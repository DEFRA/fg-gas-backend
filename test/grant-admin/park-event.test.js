import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cwStubRequests, resetCwStub, setCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

let client;
let inbox;
let outbox;

const UNKNOWN_ID = "665f1c2e9a1b2c3d4e5f6aaa";
const GAS_MAX_ATTEMPTS = 5;

const park = (service, box, id, payload, headers) =>
  wreck.post(`/grant-admin/events/${service}/${box}/${id}/park`, {
    payload,
    ...(headers ? { headers } : {}),
  });

const unpark = (service, box, id, headers) =>
  wreck.post(`/grant-admin/events/${service}/${box}/${id}/unpark`, {
    ...(headers ? { headers } : {}),
  });

const redrive = (service, box, id, headers) =>
  wreck.post(`/grant-admin/events/${service}/${box}/${id}/redrive`, {
    ...(headers ? { headers } : {}),
  });

const detail = (service, box, id) =>
  wreck.get(`/grant-admin/events/${service}/${box}/${id}`);

const bodyOf = (error) => {
  const payload = error.data?.payload;

  return Buffer.isBuffer(payload) ? JSON.parse(payload.toString()) : payload;
};

const aDeadInboxDoc = (overrides = {}) => ({
  _id: new ObjectId(),
  messageId: `msg-park-${new ObjectId().toHexString()}`,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  segregationRef: `PARK-${new ObjectId().toHexString()}`,
  status: "DEAD_LETTER",
  completionAttempts: GAS_MAX_ATTEMPTS,
  eventTime: "2026-06-16T10:00:00.000Z",
  publicationDate: "2026-06-16T10:00:01.000Z",
  lastResubmissionDate: "2026-06-16T10:05:00.000Z",
  completionDate: null,
  lastError: { name: "TypeError", message: "boom", at: null },
  attemptHistory: [{ at: null, name: "TypeError", message: "boom" }],
  parked: null,
  lastRedrive: null,
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  event: { id: "evt-park-1", time: "2026-06-16T10:00:00.000Z", data: {} },
  ...overrides,
});

const aDeadOutboxDoc = (overrides = {}) => ({
  _id: new ObjectId(),
  target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case.fifo",
  segregationRef: `PARK-${new ObjectId().toHexString()}`,
  status: "DEAD_LETTER",
  completionAttempts: GAS_MAX_ATTEMPTS,
  publicationDate: new Date("2026-06-16T10:00:00.000Z"),
  lastResubmissionDate: "2026-06-16T10:05:00.000Z",
  completionDate: null,
  lastError: null,
  attemptHistory: [],
  parked: null,
  lastRedrive: null,
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  event: {
    id: `evt-park-${new ObjectId().toHexString()}`,
    type: "cloud.defra.local.fg-gas-backend.case.create.new",
    time: "2026-06-16T10:00:00.000Z",
    data: {},
  },
  ...overrides,
});

const insert = async (collection, doc) => {
  await collection.insertOne(doc);

  return doc;
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
});

describe("POST /grant-admin/events/{service}/{box}/{id}/park", () => {
  it("moves a DEAD_LETTER row to PARKED and records the reason and the x-actor operator", async () => {
    const doc = await insert(inbox, aDeadInboxDoc());

    const { payload } = await park(
      "gas",
      "inbox",
      doc._id.toHexString(),
      { reason: "poison payload" },
      { "x-actor": "donatas" },
    );

    expect(payload.event).toMatchObject({
      service: "gas",
      box: "inbox",
      status: "PARKED",
    });
    expect(payload.event.parked).toEqual({
      at: expect.any(String),
      reason: "poison payload",
      by: "donatas",
    });

    const stored = await inbox.findOne({ _id: doc._id });

    expect(stored.status).toBe("PARKED");
    expect(stored.parked.by).toBe("donatas");
  });

  it("parks an outbox row too", async () => {
    const doc = await insert(outbox, aDeadOutboxDoc());

    const { payload } = await park("gas", "outbox", doc._id.toHexString(), {
      reason: "poison",
    });

    expect(payload.event.status).toBe("PARKED");
    expect(payload.event.parked.by).toBeNull();
  });

  it("keeps the attempts, the error and the history - the record of why it died", async () => {
    const doc = await insert(inbox, aDeadInboxDoc());

    await park("gas", "inbox", doc._id.toHexString(), { reason: "poison" });

    const stored = await inbox.findOne({ _id: doc._id });

    expect(stored.completionAttempts).toBe(GAS_MAX_ATTEMPTS);
    expect(stored.lastError.message).toBe("boom");
    expect(stored.attemptHistory).toHaveLength(1);
  });

  it("409s when the row is not DEAD_LETTER, naming the status that blocked it", async () => {
    const doc = await insert(inbox, aDeadInboxDoc({ status: "COMPLETED" }));

    const error = await park("gas", "inbox", doc._id.toHexString(), {
      reason: "poison",
    }).catch((e) => e);

    expect(error.output.statusCode).toBe(409);
    expect(bodyOf(error).status).toBe("COMPLETED");
  });

  it("404s for an id that does not exist", async () => {
    await expect(
      park("gas", "inbox", UNKNOWN_ID, { reason: "poison" }),
    ).rejects.toThrow("Response Error: 404 Not Found");
  });

  it("400s without a reason", async () => {
    const doc = await insert(inbox, aDeadInboxDoc());

    await expect(
      park("gas", "inbox", doc._id.toHexString(), {}),
    ).rejects.toThrow("Response Error: 400 Bad Request");
  });

  it("400s for an over-long x-actor header", async () => {
    const doc = await insert(inbox, aDeadInboxDoc());

    await expect(
      park(
        "gas",
        "inbox",
        doc._id.toHexString(),
        { reason: "poison" },
        { "x-actor": "x".repeat(129) },
      ),
    ).rejects.toThrow("Response Error: 400 Bad Request");
  });

  it("forwards the reason and the actor to Caseworking", async () => {
    await setCwStub({
      inbox: {
        park: {
          _id: "665f1c2e9a1b2c3d4e5f6a7b",
          eventId: "evt-1",
          type: "cloud.defra.local.fg-cw-backend.case.create",
          source: "CW",
          segregationRef: "GLD-9B2",
          status: "PARKED",
          completionAttempts: 5,
          maxAttempts: 5,
          traceparent: null,
          createdAt: "2026-06-16T10:00:00.000Z",
          lastFailureAt: null,
          lastError: null,
          completedAt: null,
          parked: {
            at: "2026-06-16T11:00:00.000Z",
            reason: "poison",
            by: "donatas",
          },
          lastRedrive: null,
        },
      },
    });

    const { payload } = await park(
      "caseworking",
      "inbox",
      "665f1c2e9a1b2c3d4e5f6a7b",
      { reason: "poison" },
      { "x-actor": "donatas" },
    );

    expect(payload.event.service).toBe("caseworking");
    expect(payload.event.status).toBe("PARKED");

    const [request] = (await cwStubRequests()).filter((r) =>
      r.path.endsWith("/park"),
    );

    expect(request.query.by).toBe("donatas");
    expect(request.body).toEqual({ reason: "poison" });
  });

  it("turns a Caseworking 409 into a 409", async () => {
    await setCwStub({ inbox: { parkConflictStatus: "COMPLETED" } });

    const error = await park(
      "caseworking",
      "inbox",
      "665f1c2e9a1b2c3d4e5f6a7b",
      { reason: "poison" },
    ).catch((e) => e);

    expect(error.output.statusCode).toBe(409);
  });
});

describe("POST /grant-admin/events/{service}/{box}/{id}/unpark", () => {
  it("moves a PARKED row back to DEAD_LETTER and clears the record", async () => {
    const doc = await insert(inbox, aDeadInboxDoc());
    const id = doc._id.toHexString();
    await park("gas", "inbox", id, { reason: "poison" });

    const { payload } = await unpark("gas", "inbox", id, {
      "x-actor": "donatas",
    });

    expect(payload.event.status).toBe("DEAD_LETTER");
    expect(payload.event.parked).toBeNull();

    const stored = await inbox.findOne({ _id: doc._id });

    expect(stored.status).toBe("DEAD_LETTER");
    expect(stored.parked).toBeNull();
  });

  it("does NOT retry the row - a redrive is the separate, explicit next step", async () => {
    const doc = await insert(inbox, aDeadInboxDoc());
    const id = doc._id.toHexString();
    await park("gas", "inbox", id, { reason: "poison" });
    await unpark("gas", "inbox", id);

    const stored = await inbox.findOne({ _id: doc._id });

    expect(stored.completionAttempts).toBe(GAS_MAX_ATTEMPTS);
    expect(stored.lastError.message).toBe("boom");
  });

  it("409s when the row is not PARKED", async () => {
    const doc = await insert(inbox, aDeadInboxDoc());

    const error = await unpark("gas", "inbox", doc._id.toHexString()).catch(
      (e) => e,
    );

    expect(error.output.statusCode).toBe(409);
    expect(bodyOf(error).status).toBe("DEAD_LETTER");
  });

  it("404s for an id that does not exist", async () => {
    await expect(unpark("gas", "inbox", UNKNOWN_ID)).rejects.toThrow(
      "Response Error: 404 Not Found",
    );
  });
});

describe("PARKED on the list, the counts and the detail", () => {
  it("shows the parked object on the list row", async () => {
    const doc = await insert(inbox, aDeadInboxDoc());
    await park(
      "gas",
      "inbox",
      doc._id.toHexString(),
      { reason: "poison" },
      { "x-actor": "donatas" },
    );

    const { payload } = await wreck.get(
      `/grant-admin/events?${new URLSearchParams({ q: doc.segregationRef })}`,
    );

    expect(payload.events[0]).toMatchObject({
      status: "PARKED",
      parked: { reason: "poison", by: "donatas" },
    });
  });

  it("shows null `parked` on a row that has never been parked", async () => {
    const doc = await insert(inbox, aDeadInboxDoc());

    const { payload } = await wreck.get(
      `/grant-admin/events?${new URLSearchParams({ q: doc.segregationRef })}`,
    );

    expect(payload.events[0].parked).toBeNull();
  });

  it("can be filtered for with status=PARKED", async () => {
    const doc = await insert(inbox, aDeadInboxDoc());
    await park("gas", "inbox", doc._id.toHexString(), { reason: "poison" });

    const { payload } = await wreck.get(
      `/grant-admin/events?${new URLSearchParams({
        q: doc.segregationRef,
        status: "PARKED",
      })}`,
    );

    expect(payload.events).toHaveLength(1);
  });

  it("carries a PARKED key on the counts response", async () => {
    const doc = await insert(inbox, aDeadInboxDoc());
    await park("gas", "inbox", doc._id.toHexString(), { reason: "poison" });

    const { payload } = await wreck.get(
      `/grant-admin/events/counts?${new URLSearchParams({
        q: doc.segregationRef,
      })}`,
    );

    expect(payload.counts).toHaveProperty("PARKED", 1);
    expect(payload.counts.DEAD_LETTER).toBe(0);
  });

  it("always carries a PARKED key, even when nothing is parked", async () => {
    const { payload } = await wreck.get("/grant-admin/events/counts");

    expect(payload.counts).toHaveProperty("PARKED");
  });

  it("shows the parked object on the detail view too", async () => {
    const doc = await insert(inbox, aDeadInboxDoc());
    const id = doc._id.toHexString();
    await park("gas", "inbox", id, { reason: "poison" }, { "x-actor": "d" });

    const { payload } = await detail("gas", "inbox", id);

    expect(payload.parked).toMatchObject({ reason: "poison", by: "d" });
  });
});

describe("the pollers ignore PARKED", () => {
  it("leaves a parked row exactly as it was across several poll ticks", async () => {
    const doc = await insert(inbox, aDeadInboxDoc());
    await park("gas", "inbox", doc._id.toHexString(), { reason: "poison" });

    // the inbox and outbox pollers run continuously in the container
    await delay(3000);

    const stored = await inbox.findOne({ _id: doc._id });

    expect(stored.status).toBe("PARKED");
    expect(stored.claimedBy).toBeNull();
    expect(stored.completionAttempts).toBe(GAS_MAX_ATTEMPTS);
    expect(stored.parked.reason).toBe("poison");
  });

  it("does the same for a parked outbox row", async () => {
    const doc = await insert(outbox, aDeadOutboxDoc());
    await park("gas", "outbox", doc._id.toHexString(), { reason: "poison" });

    await delay(3000);

    const stored = await outbox.findOne({ _id: doc._id });

    expect(stored.status).toBe("PARKED");
    expect(stored.claimedBy).toBeNull();
  });
});

describe("the actor is persisted as well as audited", () => {
  it("records lastRedrive on the row and exposes it on the detail view", async () => {
    const doc = await insert(inbox, aDeadInboxDoc());
    const id = doc._id.toHexString();

    await redrive("gas", "inbox", id, { "x-actor": "donatas" });

    const stored = await inbox.findOne({ _id: doc._id });

    expect(stored.lastRedrive).toEqual({
      at: expect.any(String),
      by: "donatas",
    });

    const { payload } = await detail("gas", "inbox", id);

    expect(payload.lastRedrive).toEqual({
      at: expect.any(String),
      by: "donatas",
    });
  });

  it("records a null actor rather than omitting the key", async () => {
    const doc = await insert(inbox, aDeadInboxDoc());

    await redrive("gas", "inbox", doc._id.toHexString());

    const stored = await inbox.findOne({ _id: doc._id });

    expect(stored.lastRedrive.by).toBeNull();
  });

  it("writes the actor into the audit event as well as onto the row", async () => {
    const doc = await insert(inbox, aDeadInboxDoc());

    await redrive("gas", "inbox", doc._id.toHexString(), {
      "x-actor": "donatas",
    });

    const audit = await outbox.findOne(
      { "event.audit.entities.action": "REDRIVE_EVENT" },
      { sort: { publicationDate: -1 } },
    );

    expect(audit.event.audit.details.actor).toBe("donatas");
  });

  it("forwards the actor to Caseworking on a redrive", async () => {
    await setCwStub({
      inbox: {
        redrive: {
          _id: "665f1c2e9a1b2c3d4e5f6a7b",
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
          lastRedrive: { at: "2026-06-16T11:00:00.000Z", by: "donatas" },
        },
      },
    });

    await redrive("caseworking", "inbox", "665f1c2e9a1b2c3d4e5f6a7b", {
      "x-actor": "donatas",
    });

    const [request] = (await cwStubRequests()).filter((r) =>
      r.path.endsWith("/redrive"),
    );

    expect(request.query.by).toBe("donatas");
  });
});
