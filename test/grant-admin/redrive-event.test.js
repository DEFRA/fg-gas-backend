import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findEventsResponseSchema } from "../../src/grant-admin/schemas/find-events-response.schema.js";
import { cwStubRequests, resetCwStub, setCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

let client;
let inbox;
let outbox;

const UNKNOWN_ID = "665f1c2e9a1b2c3d4e5f6aaa";

// .env sets INBOX_MAX_RETRIES / OUTBOX_MAX_RETRIES to 5 and the container
// reads .env, not test/vitest.config.js.
const GAS_MAX_ATTEMPTS = 5;
const POLL_MS = 50;
const WAIT_MS = 8000;

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

// exactly what the dead-letter sweep leaves behind: attempts at the cap, no
// claim, and a lastError saying why it died
const aDeadInboxDoc = (overrides = {}) => ({
  _id: new ObjectId(),
  messageId: `msg-redrive-${new ObjectId().toHexString()}`,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  segregationRef: `REDRIVE-${new ObjectId().toHexString()}`,
  status: "DEAD_LETTER",
  completionAttempts: GAS_MAX_ATTEMPTS,
  eventTime: "2026-06-16T10:00:00.000Z",
  publicationDate: "2026-06-16T10:00:01.000Z",
  lastResubmissionDate: "2026-06-16T10:05:00.000Z",
  completionDate: null,
  lastError: {
    name: "TypeError",
    message: "boom",
    at: "2026-06-16T10:05:00.000Z",
  },
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  event: { id: "evt-redrive-1", time: "2026-06-16T10:00:00.000Z", data: {} },
  ...overrides,
});

const aDeadOutboxDoc = (overrides = {}) => ({
  _id: new ObjectId(),
  target:
    "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case_fifo.fifo",
  segregationRef: `REDRIVE-${new ObjectId().toHexString()}`,
  status: "DEAD_LETTER",
  completionAttempts: GAS_MAX_ATTEMPTS,
  publicationDate: new Date("2026-06-16T10:00:00.000Z"),
  lastResubmissionDate: "2026-06-16T10:05:00.000Z",
  completionDate: null,
  lastError: null,
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  event: {
    id: `evt-redrive-${new ObjectId().toHexString()}`,
    type: "cloud.defra.local.fg-gas-backend.case.create",
    time: "2026-06-16T10:00:00.000Z",
    data: { clientRef: "CLIENT-REF-REDRIVE" },
  },
  ...overrides,
});

const aCwRow = () => ({
  eventId: "cw-msg-1",
  type: "cloud.defra.local.fg-gas-backend.case.create.new",
  source: "GAS",
  segregationRef: "CW-SEG-1",
  status: "RESUBMITTED",
  completionAttempts: 0,
  maxAttempts: 7,
  traceparent: null,
  createdAt: "2026-06-16T09:00:00.000Z",
  lastFailureAt: "2026-06-16T09:05:00.000Z",
  lastError: null,
  completedAt: null,
});

const redrive = (service, box, id) =>
  wreck.post(`/grant-admin/events/${service}/${box}/${id}/redrive`);

const bodyOf = (error) => {
  const payload = error.data?.payload;

  return Buffer.isBuffer(payload) ? JSON.parse(payload.toString()) : payload;
};

// Polls the collection until `done` is happy, so the assertion is about what
// the running poller did rather than about a fixed sleep.
const waitFor = async (collection, id, done) => {
  const seen = [];
  const deadline = Date.now() + WAIT_MS;

  while (Date.now() < deadline) {
    const doc = await collection.findOne({ _id: id });

    seen.push(doc.status);

    if (done(doc)) {
      return { doc, seen };
    }

    await delay(POLL_MS);
  }

  return { doc: await collection.findOne({ _id: id }), seen };
};

describe("POST /grant-admin/events/{service}/{box}/{id}/redrive", () => {
  describe("validation", () => {
    it("rejects an unknown service with 400", async () => {
      await expect(redrive("payments", "inbox", UNKNOWN_ID)).rejects.toThrow(
        "Response Error: 400 Bad Request",
      );
    });

    it("rejects an id that is not a 24-hex ObjectId with 400", async () => {
      await expect(redrive("gas", "inbox", "nope")).rejects.toThrow(
        "Response Error: 400 Bad Request",
      );
    });
  });

  describe("gas", () => {
    it("404s for an id that does not exist", async () => {
      await expect(redrive("gas", "inbox", UNKNOWN_ID)).rejects.toThrow(
        "Response Error: 404 Not Found",
      );
    });

    it("answers with the updated list-shaped row under `event`", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      const { payload } = await redrive("gas", "inbox", doc._id.toHexString());

      expect(payload.event).toMatchObject({
        service: "gas",
        box: "inbox",
        id: doc._id.toHexString(),
        status: "RESUBMITTED",
        attempts: 0,
        maxAttempts: GAS_MAX_ATTEMPTS,
      });
      // the row is list-shaped: no payload, no claim token
      expect(payload.event).not.toHaveProperty("payload");
      expect(payload.event).not.toHaveProperty("claimedBy");
    });

    it("keeps lastError - the record of why it died", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      const { payload } = await redrive("gas", "inbox", doc._id.toHexString());

      expect(payload.event.lastError.name).toBe("TypeError");
      expect(payload.event.lastFailureAt).toBe("2026-06-16T10:05:00.000Z");
    });

    // THE test for the attempts-reset decision: proving the row is actually
    // retried rather than dead-lettered again on the very next poll tick.
    // A GAS outbox row publishes to a real topic, so a successful redrive
    // ends at COMPLETED - which is only reachable if the poller claimed it.
    it("is picked up by the outbox poller and leaves RESUBMITTED", async () => {
      const doc = aDeadOutboxDoc();
      await outbox.insertOne(doc);

      const { payload } = await redrive("gas", "outbox", doc._id.toHexString());

      expect(payload.event.status).toBe("RESUBMITTED");

      const { doc: settled, seen } = await waitFor(
        outbox,
        doc._id,
        (row) => row.status === "COMPLETED",
      );

      expect(settled.status).toBe("COMPLETED");
      // Zero attempts MADE - the row succeeded first time after the redrive,
      // and nothing increments on the RESUBMITTED -> PUBLISHED transition any
      // more (see ATTEMPT ARITHMETIC in the models). Exactly what a newly
      // published event that succeeded first time would read.
      expect(settled.completionAttempts).toBe(0);
      expect(settled.attemptHistory ?? []).toHaveLength(0);
      expect(seen).not.toContain("DEAD_LETTER");
    }, 20000);

    it("is claimed again by the inbox poller after a redrive", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      await redrive("gas", "inbox", doc._id.toHexString());

      // this payload has no status for the handler to apply, so it fails and
      // cycles - what matters is that it was CLAIMED at all, which a row still
      // sitting at MAX_RETRIES attempts never would be
      const { doc: settled } = await waitFor(
        inbox,
        doc._id,
        (row) => row.status !== "RESUBMITTED" && row.completionAttempts >= 1,
      );

      expect(settled.status).not.toBe("RESUBMITTED");
      expect(settled.completionAttempts).toBeGreaterThanOrEqual(1);
      expect(settled.completionAttempts).toBeLessThanOrEqual(GAS_MAX_ATTEMPTS);
    }, 20000);

    it("409s with the current status when the row is not DEAD_LETTER", async () => {
      const doc = aDeadInboxDoc({ status: "COMPLETED" });
      await inbox.insertOne(doc);

      const error = await redrive("gas", "inbox", doc._id.toHexString()).catch(
        (e) => e,
      );

      expect(error.output.statusCode).toBe(409);
      expect(bodyOf(error).status).toBe("COMPLETED");
    });

    it("leaves a non-DEAD_LETTER row untouched", async () => {
      const doc = aDeadInboxDoc({ status: "COMPLETED" });
      await inbox.insertOne(doc);

      await redrive("gas", "inbox", doc._id.toHexString()).catch(() => {});

      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.status).toBe("COMPLETED");
      expect(stored.completionAttempts).toBe(GAS_MAX_ATTEMPTS);
    });

    it("writes an audit outbox event recording who redrove what", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      await redrive("gas", "inbox", doc._id.toHexString());

      const audit = await outbox.findOne({
        "event.audit.entities.action": "REDRIVE_EVENT",
      });

      expect(audit).not.toBeNull();
      expect(audit.event.audit.entities[0]).toMatchObject({
        entity: "EVENT",
        action: "REDRIVE_EVENT",
        entityid: doc._id.toHexString(),
      });
      expect(audit.event.audit.details).toMatchObject({
        service: "gas",
        box: "inbox",
      });
      expect(audit.event.audit.status).toBe("SUCCESS");
    });

    it("audits a refused redrive as a FAILURE", async () => {
      const doc = aDeadInboxDoc({ status: "COMPLETED" });
      await inbox.insertOne(doc);

      await redrive("gas", "inbox", doc._id.toHexString()).catch(() => {});

      const audit = await outbox.findOne({
        "event.audit.entities.action": "REDRIVE_EVENT",
      });

      expect(audit.event.audit.status).toBe("FAILURE");
    });
  });

  describe("caseworking", () => {
    it("calls the caseworking actuator redrive endpoint", async () => {
      await setCwStub({ outbox: { redrive: aCwRow() } });

      await redrive("caseworking", "outbox", UNKNOWN_ID);

      const [request] = await cwStubRequests();

      expect(request.path).toBe(`/actuators/outbox/${UNKNOWN_ID}/redrive`);
      expect(request.method).toBe("POST");
      expect(request.authorization).toBe("Bearer cw-stub-token");
    });

    it("normalises the caseworking row into the same list shape", async () => {
      await setCwStub({ inbox: { redrive: aCwRow() } });

      const { payload } = await redrive("caseworking", "inbox", UNKNOWN_ID);

      expect(payload.event).toMatchObject({
        service: "caseworking",
        box: "inbox",
        id: UNKNOWN_ID,
        eventId: "cw-msg-1",
        status: "RESUBMITTED",
        attempts: 0,
        maxAttempts: 7,
      });
      expect(
        findEventsResponseSchema.validate({
          events: [payload.event],
          pagination: {
            startCursor: null,
            endCursor: null,
            hasNextPage: false,
            hasPreviousPage: false,
          },
          sourceErrors: [],
        }).error,
      ).toBeUndefined();
    });

    it("passes a caseworking 404 through as a 404", async () => {
      await expect(redrive("caseworking", "inbox", UNKNOWN_ID)).rejects.toThrow(
        "Response Error: 404 Not Found",
      );
    });

    it("passes a caseworking 409 through with the status in the body", async () => {
      await setCwStub({ inbox: { redriveConflictStatus: "PUBLISHED" } });

      const error = await redrive("caseworking", "inbox", UNKNOWN_ID).catch(
        (e) => e,
      );

      expect(error.output.statusCode).toBe(409);
      expect(bodyOf(error).status).toBe("PUBLISHED");
    });

    it("502s when caseworking is unavailable", async () => {
      await setCwStub({ inbox: { mode: "down" } });

      await expect(redrive("caseworking", "inbox", UNKNOWN_ID)).rejects.toThrow(
        "Response Error: 502 Bad Gateway",
      );
    });
  });
});

describe("attempt history after a real redrive", () => {
  it("grows a fresh entry when the redriven row fails again", async () => {
    const doc = aDeadInboxDoc();
    await inbox.insertOne(doc);

    const before = await inbox.findOne({ _id: doc._id });
    expect(before.attemptHistory ?? []).toEqual([]);

    await redrive("gas", "inbox", doc._id.toHexString());

    // the poller picks the row up again; this payload has no status for the
    // handler to apply, so it fails for real and markAsFailed records it
    const { doc: settled } = await waitFor(
      inbox,
      doc._id,
      (row) => (row.attemptHistory ?? []).length > 0,
    );

    expect(settled.attemptHistory.length).toBeGreaterThan(0);
    expect(settled.attemptHistory.at(-1)).toEqual({
      at: expect.any(String),
      name: expect.any(String),
      message: expect.any(String),
    });
    expect(settled.attemptHistory.length).toBeLessThanOrEqual(10);

    // and the detail endpoint hands the same history to the frontend
    const { payload } = await wreck.get(
      `/grant-admin/events/gas/inbox/${doc._id.toHexString()}`,
    );

    expect(payload.attemptHistory.length).toBeGreaterThan(0);
    expect(payload.attemptHistory.at(-1).name).toBe(
      settled.attemptHistory.at(-1).name,
    );
  }, 20000);
});
