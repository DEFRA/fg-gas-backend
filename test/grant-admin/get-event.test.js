import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventDetailPageResponseSchema } from "../../src/grant-admin/schemas/event-detail-response.schema.js";
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

      expect(
        eventDetailPageResponseSchema.validate(detail).error,
      ).toBeUndefined();
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
        typeTitle: "cloud.defra.local.fg-cw-backend.case.status.updated",
        hop: "GAS Inbox",
        queue: "from Caseworking",
        queueValue: null,
        segregationRef: "GLD-9B2-BWS-detail",
        status: "COMPLETED",
        statusLabel: "Completed",
        statusRole: "success",
        statusRetrying: false,
        attempts: `3/${GAS_MAX_ATTEMPTS}`,
        showAttempts: true,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        createdAt: "2026-06-16T10:00:00.000Z",
        lastFailureAt: "2026-06-16T10:05:00.000Z",
        completionDate: "2026-06-16T10:06:00.000Z",
      });
      expect(detail.lastError.name).toBe("TypeError");
    });

    it("carries no latency - that column is the list's alone", async () => {
      const doc = anInboxDoc();
      await inbox.insertOne(doc);

      const detail = await detailOf("gas", "inbox", doc._id.toHexString());

      expect(detail).not.toHaveProperty("latency");
      expect(detail).not.toHaveProperty("latencyTitle");
    });

    it("returns the full event payload - the one place it crosses the wire", async () => {
      const doc = anInboxDoc();
      await inbox.insertOne(doc);

      const detail = await detailOf("gas", "inbox", doc._id.toHexString());

      expect(detail.payload).toEqual(doc.event);
      expect(detail.payload.data.nested).toEqual({ deep: true });
    });

    // A redrive with no operator behind it is the platform's own. The stored
    // document keeps its null - the absence of an operator IS the fact - and
    // only the answer names it, so a reader never has to decide what an
    // unattributed redrive is called.
    it("names an unattributed redrive System, leaving the document's null alone", async () => {
      const doc = anInboxDoc({
        lastRedrive: { at: "2026-06-16T11:05:00.000Z", by: null },
      });
      await inbox.insertOne(doc);

      const detail = await detailOf("gas", "inbox", doc._id.toHexString());

      expect(detail.lastRedrive).toEqual({
        at: "2026-06-16T11:05:00.000Z",
        by: "System",
      });

      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.lastRedrive.by).toBeNull();
    });

    it("returns a named operator exactly as it was recorded", async () => {
      const doc = anInboxDoc({
        lastRedrive: { at: "2026-06-16T11:05:00.000Z", by: "Ada Lovelace" },
      });
      await inbox.insertOne(doc);

      const detail = await detailOf("gas", "inbox", doc._id.toHexString());

      expect(detail.lastRedrive.by).toBe("Ada Lovelace");
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
      // `eventId` already names the message; a second field saying the same
      // thing could only ever disagree.
      expect(detail).not.toHaveProperty("messageId");
      expect(detail.eventId).toBe("msg-detail-1");
      expect(detail.occurredAt).toBe("2026-06-16T10:00:00.000Z");
      expect(detail.messageGroupId).toBeNull();
      expect(detail.publicationDate).toBe("2026-06-16T10:00:01.000Z");
      expect(detail.completionDate).toBe("2026-06-16T10:06:00.000Z");
      expect(detail.lastResubmissionDate).toBe("2026-06-16T10:05:00.000Z");
      expect(detail.claimedAt).toBe("2026-06-16T10:04:00.000Z");
      expect(detail.claimExpiresAt).toBe("2099-01-01T00:00:00.000Z");
    });

    // The page draws the topic name, not the ARN it was cut from: the raw
    // value's only reader was a copy button the detail page no longer has.
    it("returns the topic name on `queueValue` and no raw ARN", async () => {
      const doc = anOutboxDoc();
      await outbox.insertOne(doc);

      const detail = await detailOf("gas", "outbox", doc._id.toHexString());

      expect(detail.queueValue).toBe("gas__sns__create_new_case_fifo.fifo");
      expect(detail.queue).toBe("to Caseworking");
      expect(detail).not.toHaveProperty("targetRaw");
      expect(detail.payload).toEqual(doc.event);
    });

    // ABSENT rather than null, even though the document stores them - see the
    // detail response schema.
    it("carries none of the three inbox-only fields on an outbox row", async () => {
      const doc = anOutboxDoc();
      await outbox.insertOne(doc);

      const detail = await detailOf("gas", "outbox", doc._id.toHexString());

      expect(detail).not.toHaveProperty("segregationRef");
      expect(detail).not.toHaveProperty("traceparent");
      expect(detail).not.toHaveProperty("traceId");
      expect(doc.segregationRef).toBe("GLD-9B2-BWS-detail");
      expect(doc.event.traceparent).toBe(TRACEPARENT);
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

      expect(request.path).toBe(`/actuators/events/inbox/${UNKNOWN_ID}`);
      expect(request.method).toBe("GET");
      expect(request.authorization).toBe("Bearer cw-stub-token");
    });

    it("returns a normalised detail carrying the caseworking payload", async () => {
      await setCwStub({ inbox: { detail: aCwInboxDetail() } });

      const detail = await detailOf("caseworking", "inbox", UNKNOWN_ID);

      expect(
        eventDetailPageResponseSchema.validate(detail).error,
      ).toBeUndefined();
      expect(detail).toMatchObject({
        service: "caseworking",
        box: "inbox",
        id: UNKNOWN_ID,
        eventId: "cw-msg-1",
        hop: "CW Inbox",
        status: "DEAD_LETTER",
        statusLabel: "Dead letter",
        statusRole: "error",
        statusRetrying: false,
        // caseworking's own cap, not GAS's, riding the attempts fragment
        attempts: "7/7",
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

// The traceId derivations, asserted against real stored documents rather than
// against a mapper.
describe("GET /grant-admin/events/{service}/{box}/{id} traceId", () => {
  const traceIdOf = async (overrides) => {
    const doc = anInboxDoc(overrides);
    await inbox.insertOne(doc);

    return (await detailOf("gas", "inbox", doc._id.toHexString())).traceId;
  };

  it("extracts the 32-hex trace-id half of a W3C traceparent", async () => {
    expect(await traceIdOf({})).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  // Anything that is not a traceparent is already the value OpenSearch
  // indexes, so it is passed through untouched.
  it("passes a bare CDP request id through unchanged", async () => {
    expect(await traceIdOf({ traceparent: "cdp-request-id-1" })).toBe(
      "cdp-request-id-1",
    );
  });

  it("is null where the document carries no traceparent", async () => {
    expect(await traceIdOf({ traceparent: null })).toBeNull();
  });
});

describe("GET /grant-admin/events/{service}/{box}/{id} attemptHistory", () => {
  const anEntry = (message) => ({
    at: "2026-06-16T10:05:00.000Z",
    name: "TypeError",
    message,
    stack: null,
  });

  it("is [] for a GAS row written before attempt history existed", async () => {
    const doc = anInboxDoc();
    await inbox.insertOne(doc);

    const detail = await detailOf("gas", "inbox", doc._id.toHexString());

    expect(detail.attemptHistory).toEqual([]);
    expect(
      eventDetailPageResponseSchema.validate(detail).error,
    ).toBeUndefined();
  });

  it("returns a stored GAS inbox history oldest first", async () => {
    const attemptHistory = [anEntry("one"), anEntry("two")];
    const doc = anInboxDoc({ attemptHistory });
    await inbox.insertOne(doc);

    const detail = await detailOf("gas", "inbox", doc._id.toHexString());

    expect(detail.attemptHistory).toEqual(attemptHistory);
    expect(
      eventDetailPageResponseSchema.validate(detail).error,
    ).toBeUndefined();
  });

  it("returns a stored GAS outbox history", async () => {
    const attemptHistory = [anEntry("outbox-one")];
    const doc = anOutboxDoc({ attemptHistory });
    await outbox.insertOne(doc);

    const detail = await detailOf("gas", "outbox", doc._id.toHexString());

    expect(detail.attemptHistory).toEqual(attemptHistory);
  });

  // The stack IS served on an attempt now - the page expands a row to reveal
  // it - but the Last error fact still keeps none, and a stored key nobody
  // declared is still dropped.
  it("serves an attempt's stack, and still drops anything undeclared", async () => {
    const stack = "Error: boom\n    at handler (/app/src/x.js:1:1)";
    const doc = anInboxDoc({
      attemptHistory: [
        { ...anEntry("one"), stack, claimedBy: "SECRET-CLAIM-TOKEN" },
      ],
      lastError: {
        name: "TypeError",
        message: "boom",
        at: "2026-06-16T10:16:05.000Z",
        stack: "LAST-ERROR-STACK",
      },
    });
    await inbox.insertOne(doc);

    const { payload } = await getEvent("gas", "inbox", doc._id.toHexString());

    expect(Object.keys(payload.attemptHistory[0])).toEqual([
      "at",
      "name",
      "message",
      "stack",
    ]);
    expect(payload.attemptHistory[0].stack).toBe(stack);
    expect(Object.keys(payload.lastError)).toEqual(["name", "message", "at"]);
    expect(JSON.stringify(payload)).not.toContain("LAST-ERROR-STACK");
    expect(JSON.stringify(payload)).not.toContain("SECRET-CLAIM-TOKEN");
  });

  it("passes a Caseworking history straight through", async () => {
    const attemptHistory = [anEntry("cw-one"), anEntry("cw-two")];
    await setCwStub({
      inbox: { detail: { ...aCwInboxDetail(), attemptHistory } },
    });

    const detail = await detailOf("caseworking", "inbox", UNKNOWN_ID);

    expect(detail.attemptHistory).toEqual(attemptHistory);
    expect(
      eventDetailPageResponseSchema.validate(detail).error,
    ).toBeUndefined();
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

// Every fixture here carries a `JOURNEY-` event id, and the journey is
// selected on that id alone, so nothing the container's pollers write between
// the cleanup and the request can land in one of these assertions.

describe("GET /grant-admin/events/{service}/{box}/{id} journey", () => {
  const JOURNEY_ID = "JOURNEY-EVT-1";
  const OTHER_ID = "JOURNEY-EVT-2";

  // The inbox keys an event on `messageId`, the outbox on `event.id`, so one
  // message travelling GAS inbox -> GAS outbox carries the same id in two
  // different fields. `q` knows which field each box uses.
  const aHopInbox = (eventId, overrides = {}) =>
    anInboxDoc({
      messageId: eventId,
      segregationRef: `JOURNEY-${eventId}`,
      event: { id: eventId, time: "2026-06-16T10:00:00.000Z", data: {} },
      eventTime: "2026-06-16T10:00:00.000Z",
      ...overrides,
    });

  const aHopOutbox = (eventId, overrides = {}) =>
    anOutboxDoc({
      segregationRef: `JOURNEY-${eventId}`,
      event: {
        id: eventId,
        type: "cloud.defra.local.fg-gas-backend.case.create",
        time: "2026-06-16T10:01:00.000Z",
        data: {},
      },
      publicationDate: new Date("2026-06-16T10:01:00.000Z"),
      ...overrides,
    });

  // A Caseworking LIST row, which is what the journey reads.
  const cwHopRow = (eventId) => ({
    _id: "665f1c2e9a1b2c3d4e5f6acc",
    eventId,
    type: "cloud.defra.local.fg-cw-backend.case.status.updated",
    source: "GAS",
    status: "COMPLETED",
    completionAttempts: 1,
    maxAttempts: 7,
    createdAt: "2026-06-16T10:02:00.000Z",
    lastFailureAt: null,
    completedAt: "2026-06-16T10:02:01.000Z",
  });

  it("returns every hop carrying this event id, newest first", async () => {
    const outboxDoc = aHopOutbox(JOURNEY_ID);
    await inbox.insertOne(aHopInbox(JOURNEY_ID));
    await outbox.insertOne(outboxDoc);

    const detail = await detailOf("gas", "outbox", outboxDoc._id.toHexString());

    expect(detail.journey.map((hop) => `${hop.service}/${hop.box}`)).toEqual([
      "gas/outbox",
      "gas/inbox",
    ]);
    expect(detail.sectionErrors).toEqual([]);
    expect(
      eventDetailPageResponseSchema.validate(detail).error,
    ).toBeUndefined();
  });

  // The frontend marks the event's own row "this event", so it stays in.
  it("includes the event's own hop", async () => {
    const outboxDoc = aHopOutbox(JOURNEY_ID);
    await outbox.insertOne(outboxDoc);

    const id = outboxDoc._id.toHexString();
    const detail = await detailOf("gas", "outbox", id);

    expect(detail.journey).toHaveLength(1);
    expect(detail.journey[0].id).toBe(id);
    // The event id a hop was selected on is the page's; a hop does not repeat
    // it.
    expect(detail.journey[0]).not.toHaveProperty("eventId");
  });

  it("leaves out hops carrying a different event id", async () => {
    const outboxDoc = aHopOutbox(JOURNEY_ID);
    const otherDoc = aHopInbox(OTHER_ID);
    await outbox.insertOne(outboxDoc);
    await inbox.insertOne(otherDoc);

    const detail = await detailOf("gas", "outbox", outboxDoc._id.toHexString());

    expect(detail.journey.map((hop) => hop.id)).toEqual([
      outboxDoc._id.toHexString(),
    ]);
    expect(detail.journey.map((hop) => hop.id)).not.toContain(
      otherDoc._id.toHexString(),
    );
  });

  it("returns hops, never a payload or a list row per hop", async () => {
    const outboxDoc = aHopOutbox(JOURNEY_ID);
    await inbox.insertOne(aHopInbox(JOURNEY_ID));
    await outbox.insertOne(outboxDoc);

    const detail = await detailOf("gas", "outbox", outboxDoc._id.toHexString());

    for (const hop of detail.journey) {
      expect(Object.keys(hop).sort()).toEqual([
        "box",
        "hop",
        "id",
        "service",
        "startedAt",
        "status",
        "statusLabel",
        "statusRetrying",
        "statusRole",
        "took",
      ]);
    }
    expect(detail.payload).toBeDefined();
  });

  // An inbox row's `createdAt` is the CloudEvent's producer-stamped `time`;
  // timing from it would book the producer-to-broker leg to the consumer.
  // `publicationDate` is the receipt - on the list projection for this reason.
  it("times an inbox hop from the receipt, not the producer's clock", async () => {
    const inboxDoc = aHopInbox(JOURNEY_ID);
    await inbox.insertOne(inboxDoc);

    const detail = await detailOf("gas", "inbox", inboxDoc._id.toHexString());
    const [hop] = detail.journey;

    expect(hop.hop).toBe("GAS Inbox");
    // produced at 10:00:00, received at 10:00:01, completed at 10:06:00
    expect(hop.startedAt).toBe("2026-06-16T10:00:01.000Z");
    expect(hop.took).toBe("5m 59s");
  });

  // A row written before the receipt was kept has no `publicationDate` at all.
  it("falls back to the row's own instant when there is no receipt", async () => {
    const inboxDoc = aHopInbox(JOURNEY_ID, { publicationDate: null });
    await inbox.insertOne(inboxDoc);

    const detail = await detailOf("gas", "inbox", inboxDoc._id.toHexString());
    const [hop] = detail.journey;

    expect(hop.startedAt).toBe("2026-06-16T10:00:00.000Z");
    expect(hop.took).toBe("6m 0s");
  });

  it("times a hop from when its box took the message to its completion", async () => {
    const outboxDoc = aHopOutbox(JOURNEY_ID);
    await outbox.insertOne(outboxDoc);

    const detail = await detailOf("gas", "outbox", outboxDoc._id.toHexString());
    const [hop] = detail.journey;

    expect(hop.hop).toBe("GAS Outbox");
    // queued at 10:01:00, delivered to SNS at 10:06:00
    expect(hop.startedAt).toBe("2026-06-16T10:01:00.000Z");
    expect(hop.took).toBe("5m 0s");
  });

  it("merges Caseworking hops into the same journey", async () => {
    const outboxDoc = aHopOutbox(JOURNEY_ID);
    await outbox.insertOne(outboxDoc);
    await setCwStub({ inbox: { data: [cwHopRow(JOURNEY_ID)] } });

    const detail = await detailOf("gas", "outbox", outboxDoc._id.toHexString());

    expect(detail.journey.map((hop) => `${hop.service}/${hop.box}`)).toEqual([
      "caseworking/inbox",
      "gas/outbox",
    ]);
    expect(detail.sectionErrors).toEqual([]);
  });

  it("asks Caseworking for the hops in one read, filtered on the event id", async () => {
    const outboxDoc = aHopOutbox(JOURNEY_ID);
    await outbox.insertOne(outboxDoc);

    await detailOf("gas", "outbox", outboxDoc._id.toHexString());

    const reads = await cwStubRequests();

    expect(reads.map((request) => request.path)).toEqual(["/actuators/events"]);
    expect(reads[0].query.q).toBe(JOURNEY_ID);
    // Audit records are asked for explicitly: a journey is "what happened to
    // THIS message", so a hop missing from it is a hole rather than noise.
    expect(reads[0].query.audit).toBe("include");
  });

  // A Caseworking detail answer already carries both of its boxes searched for
  // this id, so the journey has nothing left to ask it for.
  it("asks Caseworking nothing further for its own event's journey", async () => {
    await setCwStub({
      inbox: {
        detail: {
          ...aCwInboxDetail(),
          messageId: JOURNEY_ID,
          hops: { inbox: [cwHopRow(JOURNEY_ID)], outbox: [] },
        },
      },
    });

    const detail = await detailOf("caseworking", "inbox", UNKNOWN_ID);

    expect((await cwStubRequests()).map((request) => request.path)).toEqual([
      `/actuators/events/inbox/${UNKNOWN_ID}`,
    ]);
    expect(detail.journey.map((hop) => hop.hop)).toContain("CW Inbox");
    expect(detail.sectionErrors).toEqual([]);
  });

  it("answers with just its own hop when nothing else carries the id", async () => {
    const outboxDoc = aHopOutbox(JOURNEY_ID);
    await outbox.insertOne(outboxDoc);

    const detail = await detailOf("gas", "outbox", outboxDoc._id.toHexString());

    expect(detail.journey).toHaveLength(1);
    expect(detail.journey[0].id).toBe(outboxDoc._id.toHexString());
    expect(detail.sectionErrors).toEqual([]);
  });

  // Only a journey read that fails OUTRIGHT becomes a null and a sectionError,
  // and no Caseworking failure can do that - the fan-out inside the list use
  // case swallows it into sourceErrors, which this page does not carry.
  it("still answers with the GAS hops when Caseworking is down", async () => {
    const outboxDoc = aHopOutbox(JOURNEY_ID);
    await inbox.insertOne(aHopInbox(JOURNEY_ID));
    await outbox.insertOne(outboxDoc);
    await setCwStub({ inbox: { mode: "down" }, outbox: { mode: "error" } });

    const detail = await detailOf("gas", "outbox", outboxDoc._id.toHexString());

    expect(detail.journey.map((hop) => `${hop.service}/${hop.box}`)).toEqual([
      "gas/outbox",
      "gas/inbox",
    ]);
    expect(detail.sectionErrors).toEqual([]);
    expect(detail.journey).not.toBeNull();
    expect(
      eventDetailPageResponseSchema.validate(detail).error,
    ).toBeUndefined();
  });

  it("never leaks a Caseworking response body into the page", async () => {
    const outboxDoc = aHopOutbox(JOURNEY_ID);
    await outbox.insertOne(outboxDoc);
    await setCwStub({ inbox: { mode: "unauthorized" } });

    const detail = await detailOf("gas", "outbox", outboxDoc._id.toHexString());

    expect(JSON.stringify(detail)).not.toContain("SECRET-CW-401-BODY");
  });

  // The event is the page: a detail that did not answer takes the whole call
  // with it.
  it("stays a 404 for an id that does not exist, with no journey on it", async () => {
    await expect(getEvent("gas", "outbox", UNKNOWN_ID)).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });

  it("stays a 502 when the Caseworking detail read fails", async () => {
    await setCwStub({ outbox: { mode: "error" } });

    await expect(
      getEvent("caseworking", "outbox", UNKNOWN_ID),
    ).rejects.toMatchObject({ output: { statusCode: 502 } });
  });
});

describe("swagger - the composed detail page", () => {
  it("documents the detail route with its composed response schema", async () => {
    const { payload } = await wreck.get("/swagger.json");
    const path = payload.paths["/grant-admin/events/{service}/{box}/{id}"];

    expect(JSON.stringify(path.get.responses)).toContain("EventDetailPage");
    expect(Object.keys(payload.definitions)).toEqual(
      expect.arrayContaining(["EventDetailPage", "EventDetailSectionError"]),
    );
  });
});
