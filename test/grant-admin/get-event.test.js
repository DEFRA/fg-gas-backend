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

// The container reads .env (5 retries), not test/vitest.config.js.
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

// COMPLETED with a far-future claim, so the running pollers leave it alone.
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

    it("returns the row facts one event's page draws", async () => {
      const doc = anInboxDoc();
      await inbox.insertOne(doc);

      const detail = await detailOf("gas", "inbox", doc._id.toHexString());

      expect(detail).toMatchObject({
        service: "gas",
        box: "inbox",
        id: doc._id.toHexString(),
        eventId: "msg-detail-1",
        type: "case.status.updated",
        targetTopic: null,
        segregationRef: "GLD-9B2-BWS-detail",
        status: "COMPLETED",
        statusLabel: "Completed",
        statusRole: "success",
        statusRetrying: false,
        attempts: `3/${GAS_MAX_ATTEMPTS}`,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        createdAt: "2026-06-16T10:00:01.000Z",
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

    it("returns the event id and the lifecycle dates", async () => {
      const doc = anInboxDoc();
      await inbox.insertOne(doc);

      const detail = await detailOf("gas", "inbox", doc._id.toHexString());

      expect(detail).not.toHaveProperty("messageId");
      expect(detail.eventId).toBe("msg-detail-1");
      expect(detail.completionDate).toBe("2026-06-16T10:06:00.000Z");
      expect(detail.lastResubmissionDate).toBe("2026-06-16T10:05:00.000Z");
    });

    it("returns the topic name on `targetTopic` and no raw ARN", async () => {
      const doc = anOutboxDoc();
      await outbox.insertOne(doc);

      const detail = await detailOf("gas", "outbox", doc._id.toHexString());

      expect(detail.targetTopic).toBe("gas__sns__create_new_case_fifo.fifo");
      expect(detail).not.toHaveProperty("targetRaw");
      expect(detail.payload).toEqual(doc.event);
    });

    it("carries the segregationRef on an outbox row", async () => {
      const doc = anOutboxDoc();
      await outbox.insertOne(doc);

      const detail = await detailOf("gas", "outbox", doc._id.toHexString());

      expect(eventDetailResponseSchema.validate(detail).error).toBeUndefined();
      expect(detail.segregationRef).toBe("GLD-9B2-BWS-detail");
    });

    it("carries a null segregationRef on an outbox row that stored none", async () => {
      const { segregationRef: _dropped, ...doc } = anOutboxDoc({
        status: "DEAD_LETTER",
      });
      await outbox.insertOne(doc);

      const detail = await detailOf("gas", "outbox", doc._id.toHexString());

      expect(eventDetailResponseSchema.validate(detail).error).toBeUndefined();
      expect(detail.segregationRef).toBeNull();
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

      expect(eventDetailResponseSchema.validate(detail).error).toBeUndefined();
      expect(detail).toMatchObject({
        service: "caseworking",
        box: "inbox",
        id: UNKNOWN_ID,
        eventId: "cw-msg-1",
        status: "DEAD_LETTER",
        statusLabel: "Dead letter",
        statusRole: "error",
        statusRetrying: false,
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

describe("GET /grant-admin/events/{service}/{box}/{id} traceId", () => {
  const traceIdOf = async (overrides) => {
    const doc = anInboxDoc(overrides);
    await inbox.insertOne(doc);

    return (await detailOf("gas", "inbox", doc._id.toHexString())).traceId;
  };

  it("extracts the 32-hex trace-id half of a W3C traceparent", async () => {
    expect(await traceIdOf({})).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("passes a bare CDP request id through unchanged", async () => {
    expect(await traceIdOf({ traceparent: "cdp-request-id-1" })).toBe(
      "cdp-request-id-1",
    );
  });

  it("is null where the document carries no traceparent", async () => {
    expect(await traceIdOf({ traceparent: null })).toBeNull();
  });

  describe("on an outbox row", () => {
    const outboxTraceIdOf = async (event) => {
      const doc = anOutboxDoc({ event });
      await outbox.insertOne(doc);

      return (await detailOf("gas", "outbox", doc._id.toHexString())).traceId;
    };

    it("extracts the trace-id half of a W3C event.traceparent", async () => {
      expect(
        await outboxTraceIdOf({ id: "evt-t1", traceparent: TRACEPARENT }),
      ).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    });

    it("passes a non-W3C event.traceparent through unchanged", async () => {
      expect(
        await outboxTraceIdOf({
          id: "evt-t2",
          traceparent: "cdp-request-id-2",
        }),
      ).toBe("cdp-request-id-2");
    });

    it("is null where the event carries no traceparent", async () => {
      expect(await outboxTraceIdOf({ id: "evt-t3" })).toBeNull();
    });
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

    const { payload } = await wreck.get(
      "/grant-admin/events/page?q=msg-detail-1",
    );

    expect(payload.events.length).toBeGreaterThan(0);
    for (const row of payload.events) {
      expect(row).not.toHaveProperty("attemptHistory");
    }
  });
});

describe("swagger - the detail page", () => {
  it("documents the detail route with its response schema", async () => {
    const { payload } = await wreck.get("/swagger.json");
    const path = payload.paths["/grant-admin/events/{service}/{box}/{id}"];

    expect(JSON.stringify(path.get.responses)).toContain("EventDetail");
    expect(Object.keys(payload.definitions)).toEqual(
      expect.arrayContaining(["EventDetail"]),
    );
  });
});
