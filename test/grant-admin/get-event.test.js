import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventDetailResponseSchema } from "../../src/grant-admin/schemas/event-detail-response.schema.js";
import { cwStubRequests, resetCwStub, setCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

let client;
let inbox;
let outbox;

const UNKNOWN_ID = "665f1c2e9a1b2c3d4e5f6aaa";
const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

// .env sets INBOX_MAX_RETRIES / OUTBOX_MAX_RETRIES to 5 and the container
// reads .env, not test/vitest.config.js.
const GAS_MAX_ATTEMPTS = 5;

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

// COMPLETED and a claim held to a far-future expiry: the container's pollers
// run every 250 ms and must not touch the fixtures mid-test.
const anInboxDoc = (overrides = {}) => ({
  _id: new ObjectId(),
  messageId: "msg-detail-1",
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  segregationRef: "GLD-9B2-BWS-detail",
  status: "COMPLETED",
  completionAttempts: 3,
  eventTime: "2026-06-16T10:00:00.000Z",
  publicationDate: "2026-06-16T10:00:01.000Z",
  lastResubmissionDate: "2026-06-16T10:05:00.000Z",
  completionDate: "2026-06-16T10:06:00.000Z",
  traceparent: TRACEPARENT,
  lastError: {
    name: "TypeError",
    message: "boom",
    at: "2026-06-16T10:05:00.000Z",
  },
  claimedBy: "SECRET-CLAIM-TOKEN",
  claimedAt: new Date("2026-06-16T10:04:00.000Z"),
  claimExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  event: {
    id: "evt-detail-1",
    time: "2026-06-16T10:00:00.000Z",
    data: { clientRef: "CLIENT-REF-1", nested: { deep: true } },
  },
  ...overrides,
});

const anOutboxDoc = (overrides = {}) => ({
  _id: new ObjectId(),
  target:
    "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case_fifo.fifo",
  segregationRef: "GLD-9B2-BWS-detail",
  status: "COMPLETED",
  completionAttempts: 1,
  publicationDate: new Date("2026-06-16T10:00:00.000Z"),
  lastResubmissionDate: null,
  completionDate: "2026-06-16T10:06:00.000Z",
  lastError: null,
  claimedBy: "SECRET-CLAIM-TOKEN",
  claimedAt: null,
  claimExpiresAt: null,
  event: {
    id: "evt-detail-2",
    type: "cloud.defra.local.fg-gas-backend.case.create",
    time: "2026-06-16T10:00:00.000Z",
    traceparent: TRACEPARENT,
    data: { clientRef: "CLIENT-REF-2" },
  },
  ...overrides,
});

// what the CW actuator detail endpoint answers with: the whole document
const aCwInboxDetail = () => ({
  messageId: "cw-msg-1",
  type: "cloud.defra.local.fg-gas-backend.case.create.new",
  source: "GAS",
  segregationRef: "CW-SEG-1",
  status: "DEAD_LETTER",
  completionAttempts: 7,
  maxAttempts: 7,
  traceparent: TRACEPARENT,
  eventTime: "2026-06-16T09:00:00.000Z",
  publicationDate: "2026-06-16T09:00:01.000Z",
  lastResubmissionDate: "2026-06-16T09:05:00.000Z",
  completionDate: null,
  lastError: { name: "ClaimExpired", message: "expired", at: null },
  claimedAt: null,
  claimExpiresAt: null,
  event: { id: "cw-evt-1", data: { caseRef: "CASE-REF-1" } },
});

const getEvent = (service, box, id, options) =>
  wreck.get(`/grant-admin/events/${service}/${box}/${id}`, options);

const detailOf = async (service, box, id) =>
  (await getEvent(service, box, id)).payload;

describe("GET /grant-admin/events/{service}/{box}/{id}", () => {
  describe("validation", () => {
    it("rejects an unknown service with 400", async () => {
      await expect(getEvent("payments", "inbox", UNKNOWN_ID)).rejects.toThrow(
        "Response Error: 400 Bad Request",
      );
    });

    it("rejects an unknown box with 400", async () => {
      await expect(getEvent("gas", "dlq", UNKNOWN_ID)).rejects.toThrow(
        "Response Error: 400 Bad Request",
      );
    });

    it("rejects an id that is not a 24-hex ObjectId with 400", async () => {
      await expect(getEvent("gas", "inbox", "nope")).rejects.toThrow(
        "Response Error: 400 Bad Request",
      );
    });
  });

  describe("gas", () => {
    it("404s for an id that does not exist", async () => {
      await expect(getEvent("gas", "inbox", UNKNOWN_ID)).rejects.toThrow(
        "Response Error: 404 Not Found",
      );
    });

    it("returns an inbox detail that satisfies the response schema", async () => {
      const doc = anInboxDoc();
      await inbox.insertOne(doc);

      const detail = await detailOf("gas", "inbox", doc._id.toHexString());

      expect(eventDetailResponseSchema.validate(detail).error).toBeUndefined();
    });

    it("returns everything the list row has", async () => {
      const doc = anInboxDoc();
      await inbox.insertOne(doc);

      const detail = await detailOf("gas", "inbox", doc._id.toHexString());

      expect(detail).toMatchObject({
        service: "gas",
        box: "inbox",
        id: doc._id.toHexString(),
        eventId: "msg-detail-1",
        type: "case.status.updated",
        fullType: "cloud.defra.local.fg-cw-backend.case.status.updated",
        source: "CW",
        segregationRef: "GLD-9B2-BWS-detail",
        status: "COMPLETED",
        attempts: 3,
        maxAttempts: GAS_MAX_ATTEMPTS,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        createdAt: "2026-06-16T10:00:00.000Z",
        lastFailureAt: "2026-06-16T10:05:00.000Z",
        completedAt: "2026-06-16T10:06:00.000Z",
      });
      expect(detail.lastError.name).toBe("TypeError");
    });

    it("returns the full event payload - the one place it crosses the wire", async () => {
      const doc = anInboxDoc();
      await inbox.insertOne(doc);

      const detail = await detailOf("gas", "inbox", doc._id.toHexString());

      expect(detail.payload).toEqual(doc.event);
      expect(detail.payload.data.nested).toEqual({ deep: true });
    });

    it("never returns the claim token", async () => {
      const doc = anInboxDoc();
      await inbox.insertOne(doc);

      const detail = await detailOf("gas", "inbox", doc._id.toHexString());

      expect(detail).not.toHaveProperty("claimedBy");
      expect(JSON.stringify(detail)).not.toContain("SECRET-CLAIM-TOKEN");
    });

    it("returns the raw traceparent, dates and claim window", async () => {
      const doc = anInboxDoc();
      await inbox.insertOne(doc);

      const detail = await detailOf("gas", "inbox", doc._id.toHexString());

      expect(detail.traceparent).toBe(TRACEPARENT);
      expect(detail.messageId).toBe("msg-detail-1");
      expect(detail.publicationDate).toBe("2026-06-16T10:00:01.000Z");
      expect(detail.completionDate).toBe("2026-06-16T10:06:00.000Z");
      expect(detail.lastResubmissionDate).toBe("2026-06-16T10:05:00.000Z");
      expect(detail.claimedAt).toBe("2026-06-16T10:04:00.000Z");
      expect(detail.claimExpiresAt).toBe("2099-01-01T00:00:00.000Z");
    });

    it("returns the full target ARN on `targetRaw` and the topic name on `target`", async () => {
      const doc = anOutboxDoc();
      await outbox.insertOne(doc);

      const detail = await detailOf("gas", "outbox", doc._id.toHexString());

      expect(detail.target).toBe("gas__sns__create_new_case_fifo.fifo");
      expect(detail.targetRaw).toBe(
        "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case_fifo.fifo",
      );
      expect(detail.payload).toEqual(doc.event);
    });

    it("writes an audit outbox event recording the access", async () => {
      const doc = anInboxDoc();
      await inbox.insertOne(doc);

      await detailOf("gas", "inbox", doc._id.toHexString());

      const audit = await outbox.findOne({
        "event.audit.entities.entity": "EVENT",
        "event.audit.entities.action": "VIEW_EVENT",
      });

      expect(audit).not.toBeNull();
      expect(audit.event.audit.entities[0].entityid).toBe(
        doc._id.toHexString(),
      );
      expect(audit.event.audit.details).toMatchObject({
        service: "gas",
        box: "inbox",
      });
      expect(audit.event.audit.status).toBe("SUCCESS");
    });

    it("audits a refused access as a FAILURE", async () => {
      await getEvent("gas", "inbox", UNKNOWN_ID).catch(() => {});

      const audit = await outbox.findOne({
        "event.audit.entities.action": "VIEW_EVENT",
      });

      expect(audit.event.audit.status).toBe("FAILURE");
    });
  });

  describe("caseworking", () => {
    it("calls the caseworking actuator detail endpoint", async () => {
      await setCwStub({ inbox: { detail: aCwInboxDetail() } });

      await detailOf("caseworking", "inbox", UNKNOWN_ID);

      const [request] = await cwStubRequests();

      expect(request.path).toBe(`/actuators/inbox/${UNKNOWN_ID}`);
      expect(request.method).toBe("GET");
      expect(request.authorization).toBe("Bearer cw-stub-token");
    });

    it("returns a normalised detail carrying the caseworking payload", async () => {
      await setCwStub({ inbox: { detail: aCwInboxDetail() } });

      const detail = await detailOf("caseworking", "inbox", UNKNOWN_ID);

      expect(eventDetailResponseSchema.validate(detail).error).toBeUndefined();
      expect(detail).toMatchObject({
        service: "caseworking",
        box: "inbox",
        id: UNKNOWN_ID,
        eventId: "cw-msg-1",
        status: "DEAD_LETTER",
        attempts: 7,
        // caseworking's own cap, not GAS's
        maxAttempts: 7,
      });
      expect(detail.payload).toEqual({
        id: "cw-evt-1",
        data: { caseRef: "CASE-REF-1" },
      });
    });

    it("passes a caseworking 404 through as a 404", async () => {
      await expect(
        getEvent("caseworking", "inbox", UNKNOWN_ID),
      ).rejects.toThrow("Response Error: 404 Not Found");
    });

    it("502s when caseworking is unavailable - the detail view has no partial mode", async () => {
      await setCwStub({ outbox: { mode: "down" } });

      await expect(
        getEvent("caseworking", "outbox", UNKNOWN_ID),
      ).rejects.toThrow("Response Error: 502 Bad Gateway");
    });

    it("never leaks a caseworking response body into the 502", async () => {
      await setCwStub({ outbox: { mode: "error" } });

      const error = await getEvent("caseworking", "outbox", UNKNOWN_ID).catch(
        (e) => e,
      );

      expect(error.output.statusCode).toBe(502);
      expect(JSON.stringify(error.data?.payload ?? {})).not.toContain(
        "SECRET-CW-500-BODY",
      );
    });
  });
});

describe("GET /grant-admin/events/{service}/{box}/{id} attemptHistory", () => {
  const anEntry = (message) => ({
    at: "2026-06-16T10:05:00.000Z",
    name: "TypeError",
    message,
  });

  it("is [] for a GAS row written before attempt history existed", async () => {
    const doc = anInboxDoc();
    await inbox.insertOne(doc);

    const detail = await detailOf("gas", "inbox", doc._id.toHexString());

    expect(detail.attemptHistory).toEqual([]);
    expect(eventDetailResponseSchema.validate(detail).error).toBeUndefined();
  });

  it("returns a stored GAS inbox history oldest first", async () => {
    const attemptHistory = [anEntry("one"), anEntry("two")];
    const doc = anInboxDoc({ attemptHistory });
    await inbox.insertOne(doc);

    const detail = await detailOf("gas", "inbox", doc._id.toHexString());

    expect(detail.attemptHistory).toEqual(attemptHistory);
    expect(eventDetailResponseSchema.validate(detail).error).toBeUndefined();
  });

  it("returns a stored GAS outbox history", async () => {
    const attemptHistory = [anEntry("outbox-one")];
    const doc = anOutboxDoc({ attemptHistory });
    await outbox.insertOne(doc);

    const detail = await detailOf("gas", "outbox", doc._id.toHexString());

    expect(detail.attemptHistory).toEqual(attemptHistory);
  });

  it("never puts a stored stack on the wire", async () => {
    const doc = anInboxDoc({
      attemptHistory: [{ ...anEntry("one"), stack: "SECRET-STACK" }],
    });
    await inbox.insertOne(doc);

    const { payload } = await getEvent("gas", "inbox", doc._id.toHexString());

    expect(JSON.stringify(payload)).not.toContain("SECRET-STACK");
    expect(Object.keys(payload.attemptHistory[0])).toEqual([
      "at",
      "name",
      "message",
    ]);
  });

  it("passes a Caseworking history straight through", async () => {
    const attemptHistory = [anEntry("cw-one"), anEntry("cw-two")];
    await setCwStub({
      inbox: { detail: { ...aCwInboxDetail(), attemptHistory } },
    });

    const detail = await detailOf("caseworking", "inbox", UNKNOWN_ID);

    expect(detail.attemptHistory).toEqual(attemptHistory);
    expect(eventDetailResponseSchema.validate(detail).error).toBeUndefined();
  });

  it("is [] for a Caseworking row that has none", async () => {
    await setCwStub({ inbox: { detail: aCwInboxDetail() } });

    const detail = await detailOf("caseworking", "inbox", UNKNOWN_ID);

    expect(detail.attemptHistory).toEqual([]);
  });

  it("is not on a list row", async () => {
    const doc = anInboxDoc({ attemptHistory: [anEntry("one")] });
    await inbox.insertOne(doc);

    const { payload } = await wreck.get("/grant-admin/events?q=msg-detail-1");

    expect(payload.events.length).toBeGreaterThan(0);
    for (const row of payload.events) {
      expect(row).not.toHaveProperty("attemptHistory");
    }
  });
});
