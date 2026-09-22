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

// The container reads .env (retries = 5), not test/vitest.config.js.
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

const pastAttempts = () =>
  Array.from({ length: GAS_MAX_ATTEMPTS }, (_, n) => ({
    at: `2026-06-16T10:0${n}:00.000Z`,
    name: "Error",
    message: "PRE-REDRIVE-FAILURE",
    stack: null,
  }));

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
  attemptHistory: pastAttempts(),
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  event: { id: "evt-redrive-1", time: "2026-06-16T10:00:00.000Z", data: {} },
  ...overrides,
});

// At the cap, so a dead-letter sweep tick would re-kill it were the sweep to
// match on the attempt count alone.
const aCompletedInboxDoc = () =>
  aDeadInboxDoc({ status: "COMPLETED", completionAttempts: GAS_MAX_ATTEMPTS });

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
  attemptHistory: pastAttempts(),
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

const redrive = (service, box, id) =>
  wreck.post(`/grant-admin/events/${service}/${box}/${id}/redrive`);

const bodyOf = (error) => {
  const payload = error.data?.payload;

  return Buffer.isBuffer(payload) ? JSON.parse(payload.toString()) : payload;
};

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

    it("answers 204 with no body", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      const { res, payload } = await redrive(
        "gas",
        "inbox",
        doc._id.toHexString(),
      );

      expect(res.statusCode).toBe(204);
      expect(payload.length ?? 0).toBe(0);
    });

    it("keeps lastError - the record of why it died", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      await redrive("gas", "inbox", doc._id.toHexString());

      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.lastRedrive).toEqual({ at: expect.any(String), by: null });
      // The poller may already have retried the row, which replaces the error.
      expect(stored.lastError).not.toBeNull();
    });

    it.each([
      ["inbox", () => inbox, aDeadInboxDoc],
      ["outbox", () => outbox, aDeadOutboxDoc],
    ])(
      "clears the %s row's attempt history as it resets the count",
      async (box, collectionOf, aDoc) => {
        const doc = aDoc({ status: "DEAD_LETTER" });
        await collectionOf().insertOne(doc);

        await redrive("gas", box, doc._id.toHexString());

        // The poller may already have run the row again.
        const stored = await collectionOf().findOne({ _id: doc._id });

        expect(JSON.stringify(stored.attemptHistory)).not.toContain(
          "PRE-REDRIVE-FAILURE",
        );
        expect(stored.attemptHistory.length).toBe(stored.completionAttempts);
      },
    );

    it("is picked up by the outbox poller and leaves RESUBMITTED", async () => {
      const doc = aDeadOutboxDoc();
      await outbox.insertOne(doc);

      await redrive("gas", "outbox", doc._id.toHexString());

      const { doc: settled, seen } = await waitFor(
        outbox,
        doc._id,
        (row) => row.status === "COMPLETED",
      );

      expect(settled.status).toBe("COMPLETED");
      expect(settled.completionAttempts).toBe(0);
      expect(settled.attemptHistory ?? []).toHaveLength(0);
      expect(seen).not.toContain("DEAD_LETTER");
    }, 20000);

    it("is claimed again by the inbox poller after a redrive", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      await redrive("gas", "inbox", doc._id.toHexString());

      // This payload fails in the handler; what matters is that it was claimed at all.
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
      const doc = aCompletedInboxDoc();
      await inbox.insertOne(doc);

      const error = await redrive("gas", "inbox", doc._id.toHexString()).catch(
        (e) => e,
      );

      expect(error.output.statusCode).toBe(409);
      expect(bodyOf(error).status).toBe("COMPLETED");
      expect(bodyOf(error).statusLabel).toBe("Completed");
    });

    it("leaves a non-DEAD_LETTER row untouched", async () => {
      const doc = aCompletedInboxDoc();
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

      // Scoped to this row: nothing clears the outbox between tests.
      const audit = await outbox.findOne({
        "event.audit.entities.action": "REDRIVE_EVENT",
        "event.audit.entities.entityid": doc._id.toHexString(),
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

      const stored = await inbox.findOne({ _id: doc._id });

      // Not RESUBMITTED: the running poller sweeps that to PUBLISHED every 250ms, and the
      // outbox assertions above give it time to. The redrive itself is what matters here,
      // and the exact status is covered in inbox.repository.test.js.
      expect(stored.status).not.toBe("DEAD_LETTER");
      expect(stored.lastRedrive).not.toBeNull();
    });

    it("audits a refused redrive as a FAILURE", async () => {
      const doc = aCompletedInboxDoc();
      await inbox.insertOne(doc);

      await redrive("gas", "inbox", doc._id.toHexString()).catch(() => {});

      const audit = await outbox.findOne({
        "event.audit.entities.action": "REDRIVE_EVENT",
        "event.audit.entities.entityid": doc._id.toHexString(),
      });

      expect(audit.event.audit.status).toBe("FAILURE");
    });
  });

  describe("caseworking", () => {
    it("calls the caseworking actuator redrive endpoint", async () => {
      await setCwStub({ outbox: { redrive: true } });

      await redrive("caseworking", "outbox", UNKNOWN_ID);

      const [request] = await cwStubRequests();

      expect(request.path).toBe(
        `/actuators/events/outbox/${UNKNOWN_ID}/redrive`,
      );
      expect(request.method).toBe("POST");
      expect(request.authorization).toBe("Bearer cw-stub-token");
    });

    it("answers 204 once Caseworking has redriven the row", async () => {
      await setCwStub({ inbox: { redrive: true } });

      const { res } = await redrive("caseworking", "inbox", UNKNOWN_ID);

      expect(res.statusCode).toBe(204);
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
      expect(bodyOf(error).statusLabel).toBe("Queued");
    });

    // Caseworking may still commit after GAS gives up, so this is not a refusal.
    it(
      "504s when caseworking does not answer in time",
      { timeout: 15000 },
      async () => {
        await setCwStub({ inbox: { mode: "timeout" } });

        const error = await redrive("caseworking", "inbox", UNKNOWN_ID).catch(
          (e) => e,
        );

        expect(error.output.statusCode).toBe(504);
      },
    );

    it("502s when caseworking is unavailable", async () => {
      await setCwStub({ inbox: { mode: "down" } });

      await expect(redrive("caseworking", "inbox", UNKNOWN_ID)).rejects.toThrow(
        "Response Error: 502 Bad Gateway",
      );
    });
  });
});

describe("attempt history after a real redrive", () => {
  it("holds only post-redrive attempts when the redriven row fails again", async () => {
    const doc = aDeadInboxDoc();
    await inbox.insertOne(doc);

    const before = await inbox.findOne({ _id: doc._id });
    expect(before.attemptHistory).toHaveLength(GAS_MAX_ATTEMPTS);

    await redrive("gas", "inbox", doc._id.toHexString());

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
      stack: expect.any(String),
    });
    expect(settled.attemptHistory.length).toBeLessThanOrEqual(GAS_MAX_ATTEMPTS);
    expect(JSON.stringify(settled.attemptHistory)).not.toContain(
      "PRE-REDRIVE-FAILURE",
    );
    expect(settled.attemptHistory).toHaveLength(settled.completionAttempts);

    const { payload } = await wreck.get(
      `/grant-admin/events/gas/inbox/${doc._id.toHexString()}`,
    );

    expect(payload.attemptHistory.length).toBeGreaterThan(0);
    expect(payload.attemptHistory.at(-1).name).toBe(
      settled.attemptHistory.at(-1).name,
    );
    expect(payload.attemptHistory.at(-1).stack).toBe(
      settled.attemptHistory.at(-1).stack,
    );
  }, 20000);
});
