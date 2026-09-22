import Joi from "joi";
import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  eventPaginationSchema,
  eventRowSchema,
  eventSourceErrorSchema,
} from "../schemas/events-shared.schema.js";
import {
  normaliseCwListRow,
  normaliseGasInbox,
  normaliseGasOutbox,
  toAttemptHistory,
  toEventRow,
  toEventTuple,
} from "./map-event-row.js";

// The list slice of the events page answer.
const listResponseSchema = Joi.object({
  events: Joi.array().items(eventRowSchema).required(),
  pagination: eventPaginationSchema.required(),
  sourceErrors: Joi.array().items(eventSourceErrorSchema).required(),
});

const HEX_ID = "665f1c2e9a1b2c3d4e5f6a7b";
const OBJECT_ID = ObjectId.createFromHexString(HEX_ID);

// 665f1c2e -> 1717490222 seconds
const ID_TIMESTAMP = new Date(0x665f1c2e * 1000).toISOString();

const GAS_INBOX_MAX = 5;
const GAS_OUTBOX_MAX = 5;

const gasInboxDoc = (overrides = {}) => ({
  _id: OBJECT_ID,
  messageId: "msg-1",
  type: "cloud.defra.prd.fg-cw-backend.case.status.updated",
  source: "AS",
  status: "PUBLISHED",
  completionAttempts: 1,
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  eventTime: "2026-06-16T09:59:58.000Z",
  publicationDate: "2026-06-16T10:00:00.000Z",
  lastResubmissionDate: null,
  completionDate: null,
  segregationRef: "GLD-9B2-BWS-grasslands",
  ...overrides,
});

const gasOutboxDoc = (overrides = {}) => ({
  _id: OBJECT_ID,
  target:
    "arn:aws:sns:eu-west-2:000000000000:gas__sns__update_case_status_fifo.fifo",
  event: {
    id: "evt-1",
    type: "cloud.defra.prd.fg-gas-backend.case.status.updated",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  },
  status: "PUBLISHED",
  completionAttempts: 2,
  publicationDate: new Date("2026-06-16T10:00:00.000Z"),
  lastResubmissionDate: null,
  completionDate: null,
  segregationRef: "GLD-9B2-BWS-grasslands",
  ...overrides,
});

const cwInboxRow = (overrides = {}) => ({
  _id: HEX_ID,
  eventId: "msg-9",
  type: "cloud.defra.prd.fg-gas-backend.case.create",
  status: "PROCESSING",
  publicationDate: "2026-06-16T10:00:00.000Z",
  completedAt: null,
  ...overrides,
});

const cwOutboxRow = (overrides = {}) => ({
  _id: HEX_ID,
  eventId: "evt-9",
  type: "cloud.defra.prd.fg-cw-backend.case.status.updated",
  status: "COMPLETED",
  publicationDate: "2026-06-16T10:00:00.000Z",
  completedAt: "2026-06-16T10:01:00.000Z",
  ...overrides,
});

const gasInboxParts = (overrides) => ({
  key: "gasInbox",
  service: "gas",
  box: "inbox",
  intermediate: normaliseGasInbox(gasInboxDoc(overrides), GAS_INBOX_MAX),
});

const gasInboxTuple = (overrides) => toEventTuple(gasInboxParts(overrides));

const gasInboxSingle = (overrides) => toEventRow(gasInboxParts(overrides));

const AUDIT_ARN =
  "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn";

const gasOutboxParts = (overrides) => ({
  key: "gasOutbox",
  service: "gas",
  box: "outbox",
  intermediate: normaliseGasOutbox(gasOutboxDoc(overrides), GAS_OUTBOX_MAX),
});

const gasOutboxTuple = (overrides) => toEventTuple(gasOutboxParts(overrides));

const gasOutboxSingle = (overrides) => toEventRow(gasOutboxParts(overrides));

const cwInboxParts = (overrides) => ({
  key: "cwInbox",
  service: "caseworking",
  box: "inbox",
  intermediate: normaliseCwListRow(cwInboxRow(overrides)),
});

const cwInboxTuple = (overrides) => toEventTuple(cwInboxParts(overrides));

const cwOutboxParts = (overrides) => ({
  key: "cwOutbox",
  service: "caseworking",
  box: "outbox",
  intermediate: normaliseCwListRow(cwOutboxRow(overrides)),
});

const cwOutboxTuple = (overrides) => toEventTuple(cwOutboxParts(overrides));

describe("map-event-row", () => {
  it("maps a GAS outbox CloudEvent row: eventId from event.id, namespace stripped from type, and its own duration", () => {
    const { row } = gasOutboxTuple();

    expect(row).toEqual({
      service: "gas",
      box: "outbox",
      id: HEX_ID,
      eventId: "evt-1",
      type: "case.status.updated",
      status: "PUBLISHED",
      statusLabel: "Queued",
      statusRole: "neutral",
      statusRetrying: false,
      createdAt: "2026-06-16T10:00:00.000Z",
      latency: null,
      latencyTitle: "Queued to delivered to SNS",
    });
  });

  it("maps a GAS inbox row: eventId from messageId, and no topic of its own", () => {
    const { row } = gasInboxTuple();

    expect(row.eventId).toEqual("msg-1");
    expect(row.type).toEqual("case.status.updated");
    expect(row.box).toEqual("inbox");
    expect(gasInboxSingle().targetTopic).toBeNull();
  });

  it("maps a CW inbox wire row: hex _id passed through, publicationDate used verbatim as the cursor value", () => {
    const tuple = cwInboxTuple({ publicationDate: "2026-06-16T10:00:00Z" });

    expect(tuple.id).toEqual(HEX_ID);
    expect(tuple.cursorValue).toEqual("2026-06-16T10:00:00Z");
    expect(tuple.row.id).toEqual(HEX_ID);
    expect(tuple.row.eventId).toEqual("msg-9");
    expect(tuple.row.service).toEqual("caseworking");
  });

  it("times a CW outbox list row from receipt to completion", () => {
    expect(cwOutboxTuple().row.latency).toEqual("1m 0s");
  });

  it("keeps a legacy io.onsite.agreement.status.updated type whole", () => {
    const { row } = gasOutboxTuple({
      event: { id: "evt-1", type: "io.onsite.agreement.status.updated" },
    });

    expect(row.type).toEqual("io.onsite.agreement.status.updated");
  });

  it("keeps a legacy io.onsite.agreement.create-payment type whole", () => {
    const { row } = gasOutboxTuple({
      event: { id: "evt-1", type: "io.onsite.agreement.create-payment" },
    });

    expect(row.type).toEqual("io.onsite.agreement.create-payment");
  });

  it("labels a GAS audit outbox row audit", () => {
    const { row } = gasOutboxTuple({
      target: AUDIT_ARN,
      event: {
        audit: {
          entities: [{ entity: "APPLICATION", action: "SUBMIT_APPLICATION" }],
        },
      },
    });

    expect(row.type).toBe("audit");
  });

  it("labels a type-less CW row unknown, not audit", () => {
    const { row } = cwOutboxTuple({ eventId: null, type: null });

    expect(row.type).toBe("unknown");
  });

  it("never reads auditEntities, on either wire shape", () => {
    const entities = [{ entity: "APPLICATION", action: "SUBMIT_APPLICATION" }];

    expect(
      cwOutboxTuple({ type: null, auditEntities: entities }).row.type,
    ).toBe("unknown");
    expect(
      cwOutboxTuple({
        type: "cloud.defra.prd.fg-cw-backend.case.create",
        auditEntities: entities,
      }).row.type,
    ).toEqual("case.create");
  });

  it("falls back to _id for eventId on an audit row", () => {
    const { row } = gasOutboxTuple({
      event: { audit: { entities: [{ entity: "GRANT", action: "CREATE" }] } },
    });

    expect(row.eventId).toEqual(HEX_ID);
  });

  it("labels an audit row with an empty entities array, and still returns the row", () => {
    const { row } = gasOutboxTuple({
      target: AUDIT_ARN,
      event: { audit: { entities: [] } },
    });

    expect(row.type).toBe("audit");
    expect(row.id).toEqual(HEX_ID);
  });

  it("labels a type-less row on another topic unknown", () => {
    const { row } = gasOutboxTuple({ event: { id: "evt-1" } });

    expect(row.type).toBe("unknown");
  });

  it("labels a type-less row on the audit topic audit", () => {
    const { row } = gasOutboxTuple({
      target: AUDIT_ARN,
      event: { id: "evt-1" },
    });

    expect(row.type).toBe("audit");
  });

  it("labels a type-less inbox row unknown, never audit", () => {
    const { row } = gasInboxTuple({ type: null });

    expect(row.type).toBe("unknown");
  });

  it("never labels a row audit just because its type shortens to nothing", () => {
    const { row } = gasOutboxTuple({
      event: { id: "evt-1", type: "cloud.defra.prd.fg-gas-backend." },
    });

    expect(row.type).toBe("cloud.defra.prd.fg-gas-backend.");
  });

  it("never reads entityid or details from an audit entity", () => {
    const { row } = gasOutboxTuple({
      event: {
        audit: {
          entities: [
            {
              entity: "APPLICATION",
              action: "SUBMIT_APPLICATION",
              entityid: "APP-SECRET-123",
            },
          ],
          details: { query: "secret" },
        },
      },
    });

    expect(JSON.stringify(row)).not.toContain("APP-SECRET-123");
    expect(JSON.stringify(row)).not.toContain("entityid");
    expect(JSON.stringify(row)).not.toContain("details");
  });

  it("reduces internal:message-bus to internal, not message-bus", () => {
    expect(
      gasOutboxSingle({ target: "internal:message-bus" }).targetTopic,
    ).toEqual("internal");
  });

  it("reduces a .fifo SNS ARN to its topic name and never emits a full ARN", () => {
    const target = "arn:aws:sns:eu-west-2:000000000000:create_payment.fifo";

    expect(gasOutboxSingle({ target }).targetTopic).toEqual(
      "create_payment.fifo",
    );
    expect(JSON.stringify(gasOutboxSingle({ target }))).not.toContain(
      "arn:aws",
    );
    expect(JSON.stringify(gasOutboxTuple({ target }).row)).not.toContain(
      "arn:aws",
    );
  });

  it("falls back to the _id timestamp when an inbox publicationDate is null", () => {
    const tuple = gasInboxTuple({ publicationDate: null });

    expect(tuple.cursorValue).toBeNull();
    expect(tuple.row.createdAt).toEqual(ID_TIMESTAMP);
  });

  it("falls back to the _id timestamp when publicationDate is an unparsable string", () => {
    const tuple = gasOutboxTuple({ publicationDate: "not a date" });

    expect(tuple.row.createdAt).toEqual(ID_TIMESTAMP);
  });

  it("keeps order null while createdAt shows the _id fallback", () => {
    const tuple = gasInboxTuple({ publicationDate: null });

    expect(tuple.order).toBeNull();
    expect(tuple.row.createdAt).toEqual(ID_TIMESTAMP);
  });

  it("uses the raw stored inbox publicationDate string as the cursor value without canonicalising it", () => {
    const tuple = gasInboxTuple({ publicationDate: "2026-06-16T10:00:00Z" });

    expect(tuple.cursorValue).toEqual("2026-06-16T10:00:00Z");
    expect(tuple.row.createdAt).toEqual("2026-06-16T10:00:00.000Z");
  });

  it("dates an inbox row by its publicationDate, never its eventTime", () => {
    const tuple = gasInboxTuple({
      eventTime: "2026-06-16T09:00:00.000Z",
      publicationDate: "2026-06-16T10:00:00.123Z",
    });

    expect(tuple.cursorValue).toEqual("2026-06-16T10:00:00.123Z");
    expect(tuple.order).toEqual(Date.parse("2026-06-16T10:00:00.123Z"));
    expect(tuple.row.createdAt).toEqual("2026-06-16T10:00:00.123Z");
  });

  it("carries an inbox publicationDate stored as a Date as an ISO cursor value", () => {
    const tuple = gasInboxTuple({
      publicationDate: new Date("2026-06-16T10:00:00.123Z"),
    });

    expect(tuple.cursorValue).toEqual("2026-06-16T10:00:00.123Z");
    expect(tuple.row.createdAt).toEqual("2026-06-16T10:00:00.123Z");
  });

  it("uses an ISO string for the outbox cursor value when publicationDate is a Date", () => {
    const tuple = gasOutboxTuple();

    expect(tuple.cursorValue).toEqual("2026-06-16T10:00:00.000Z");
  });

  it("takes the attempts ceiling from GAS config", () => {
    expect(gasInboxSingle().attempts).toEqual(`1/${GAS_INBOX_MAX}`);
    expect(gasOutboxSingle().attempts).toEqual(`2/${GAS_OUTBOX_MAX}`);
  });

  it("spells the status the way the toolbar's chips do", () => {
    expect(gasInboxTuple({ status: "DEAD_LETTER" }).row).toMatchObject({
      status: "DEAD_LETTER",
      statusLabel: "Dead letter",
      statusRole: "error",
      statusRetrying: false,
    });
    expect(cwInboxTuple({ status: "FAILED" }).row).toMatchObject({
      statusLabel: "Failed",
      statusRole: "warning",
      statusRetrying: true,
    });
  });

  it("adds a latency and its title to the list row alone", () => {
    expect(
      gasInboxTuple({ completionDate: "2026-06-16T10:00:01.500Z" }).row,
    ).toMatchObject({
      latency: "1.5s",
      latencyTitle: "Received to completed",
    });
    expect(gasOutboxTuple().row.latency).toBeNull();
  });

  it("normalises GAS timestamp strings to ISO", () => {
    const overrides = {
      lastResubmissionDate: "2026-06-16T10:16:05Z",
      completionDate: "2026-06-16T10:20:00Z",
    };

    expect(gasInboxTuple(overrides).row.latency).toEqual("20m 0s");
  });

  it("produces a row that satisfies the response schema", () => {
    const events = [
      gasInboxTuple().row,
      gasOutboxTuple().row,
      cwInboxTuple().row,
      cwOutboxTuple().row,
      gasOutboxTuple({ event: { audit: { entities: [] } } }).row,
      gasInboxTuple({ publicationDate: null }).row,
    ];

    const { error } = listResponseSchema.validate({
      events,
      pagination: {
        endCursor: null,
        hasNextPage: false,
      },
      sourceErrors: [],
    });

    expect(error).toBeUndefined();
  });

  it("carries no trace id at all", () => {
    expect(gasInboxTuple().row).not.toHaveProperty("traceId");
    expect(gasOutboxTuple().row).not.toHaveProperty("traceId");
    expect(cwInboxTuple().row).not.toHaveProperty("traceId");
    expect(cwOutboxTuple().row).not.toHaveProperty("traceId");
  });

  it("never reads an audit row's correlationid", () => {
    const { row } = gasOutboxTuple({
      event: {
        audit: {
          entities: [{ entity: "APPLICATION", action: "SUBMIT_APPLICATION" }],
        },
        correlationid: "d0f7b2a4-1111-2222-3333-444455556666",
      },
    });

    expect(JSON.stringify(row)).not.toContain("d0f7b2a4");
    expect(JSON.stringify(row)).not.toContain("correlationid");
  });

  it("never emits event, event.data, claimedBy or kind even when present on the input", () => {
    const { row } = gasOutboxTuple({
      claimedBy: "worker-1",
      kind: "domain",
      event: {
        id: "evt-1",
        type: "cloud.defra.prd.fg-gas-backend.case.create",
        data: { clientRef: "SECRET-REF" },
      },
    });

    const serialised = JSON.stringify(row);

    expect(serialised).not.toContain("claimedBy");
    expect(serialised).not.toContain("kind");
    expect(serialised).not.toContain("auditEntities");
    expect(serialised).not.toContain("SECRET-REF");
    expect(row).not.toHaveProperty("event");
  });

  it("takes nothing at all from an event that also carries a payload", () => {
    const { row } = gasOutboxTuple({
      event: {
        id: "evt-1",
        type: "cloud.defra.prd.fg-gas-backend.case.create",
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        subject: "SECRET-SUBJECT",
        source: "SECRET-SOURCE",
        data: { clientRef: "SECRET-REF", sbi: "123456789" },
      },
    });

    expect(row).not.toHaveProperty("traceparent");
    expect(JSON.stringify(row)).not.toMatch(
      /SECRET-SUBJECT|SECRET-SOURCE|SECRET-REF|123456789/,
    );
  });
});

describe("map-event-row lastError", () => {
  const lastError = {
    name: "ClaimExpired",
    message: "claim expired before completion",
    at: "2026-06-16T10:16:05.000Z",
  };

  it("is null on both boxes when the document has no lastError", () => {
    expect(gasInboxSingle().lastError).toBeNull();
    expect(gasOutboxSingle().lastError).toBeNull();
  });

  it("passes a GAS inbox lastError through unchanged", () => {
    expect(gasInboxSingle({ lastError }).lastError).toEqual(lastError);
  });

  it("passes a GAS outbox lastError through unchanged", () => {
    expect(gasOutboxSingle({ lastError }).lastError).toEqual(lastError);
  });

  it("rebuilds a lastError missing its name and message rather than failing the page", () => {
    const row = gasOutboxSingle({
      lastError: { at: "2026-06-16T10:16:05.000Z" },
    });

    expect(row.lastError).toEqual({
      name: "Error",
      message: "",
      at: "2026-06-16T10:16:05.000Z",
    });
  });

  it("returns a null at for an unparseable stored timestamp", () => {
    const row = gasOutboxSingle({
      lastError: { name: "Error", message: "boom", at: "not-a-date" },
    });

    expect(row.lastError.at).toBeNull();
  });

  it("drops any extra key a stored lastError carries", () => {
    const row = gasOutboxSingle({
      lastError: { ...lastError, stack: "SECRET-STACK" },
    });

    expect(Object.keys(row.lastError)).toEqual(["name", "message", "at"]);
  });

  it("maps a failed document to a list row the schema accepts", () => {
    const { row } = gasOutboxTuple({ lastError });
    const { error } = listResponseSchema.validate({
      events: [row],
      pagination: { endCursor: null, hasNextPage: false },
      sourceErrors: [],
    });

    expect(error).toBeUndefined();
  });
});

describe("toAttemptHistory", () => {
  it("is an empty array for a missing or malformed history", () => {
    expect(toAttemptHistory(undefined)).toEqual([]);
    expect(toAttemptHistory(null)).toEqual([]);
    expect(toAttemptHistory("nope")).toEqual([]);
  });

  it("rebuilds each entry from its four contract keys only", () => {
    expect(
      toAttemptHistory([
        {
          at: "2026-06-16T10:05:00.000Z",
          name: "TypeError",
          message: "boom",
          stack: "Error: boom\n    at handler (x.js:1:1)",
          claimedBy: "SECRET-CLAIM-TOKEN",
        },
      ]),
    ).toEqual([
      {
        at: "2026-06-16T10:05:00.000Z",
        name: "TypeError",
        message: "boom",
        stack: "Error: boom\n    at handler (x.js:1:1)",
      },
    ]);
  });

  it("serves a null stack where the stored entry has none", () => {
    expect(toAttemptHistory([{ name: "ClaimExpired" }]).at(0).stack).toBeNull();
  });

  it("normalises a Date at into an ISO string and an unparseable one into null", () => {
    expect(
      toAttemptHistory([{ at: new Date("2026-06-16T10:05:00.000Z") }]).at(0).at,
    ).toBe("2026-06-16T10:05:00.000Z");
    expect(toAttemptHistory([{ at: "not a date" }]).at(0).at).toBeNull();
  });

  it("defaults a missing name to Error and a missing message to empty", () => {
    expect(toAttemptHistory([{}])).toEqual([
      { at: null, name: "Error", message: "", stack: null },
    ]);
  });

  it("keeps only the ten most recent entries", () => {
    const history = toAttemptHistory(
      Array.from({ length: 14 }, (_, i) => ({ message: `${i}` })),
    );

    expect(history).toHaveLength(10);
    expect(history.at(0).message).toBe("4");
  });
});

describe("a Caseworking row's own label", () => {
  it("takes an audit label Caseworking derived", () => {
    const { row } = cwInboxTuple({
      type: "audit",
    });

    expect(row.type).toEqual("audit");
  });

  it("takes an unknown label Caseworking derived", () => {
    const { row } = cwInboxTuple({
      type: "unknown",
    });

    expect(row.type).toEqual("unknown");
  });

  it("still strips the namespace off a real Caseworking type", () => {
    const { row } = cwInboxTuple({
      type: "cloud.defra.prd.fg-cw-backend.case.status.updated",
    });

    expect(row.type).toEqual("case.status.updated");
  });

  it("falls back to unknown for a Caseworking that sends no type", () => {
    expect(cwInboxTuple({ type: null }).row.type).toEqual("unknown");
  });
});

describe("the tuple beside each row", () => {
  it("carries its keyset position beside the row", () => {
    expect(Object.keys(gasOutboxTuple()).sort()).toEqual([
      "cursorValue",
      "id",
      "key",
      "order",
      "row",
    ]);
  });

  it("times an inbox row from its receipt, whatever the sender's event time", () => {
    const tuple = gasInboxTuple({
      eventTime: "2026-06-16T10:00:00.000Z",
      publicationDate: "2026-06-16T10:00:02.000Z",
      completionDate: "2026-06-16T10:00:03.500Z",
    });

    expect(tuple.row.latency).toEqual("1.5s");
  });
});
