import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { findEventsResponseSchema } from "../schemas/find-events-response.schema.js";
import {
  normaliseCwInbox,
  normaliseCwOutbox,
  normaliseGasInbox,
  normaliseGasOutbox,
  toAttemptHistory,
  toEventTuple,
} from "./map-event-row.js";

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
  eventTime: "2026-06-16T10:00:00.000Z",
  lastResubmissionDate: null,
  completionDate: null,
  segregationRef: "GLD-9B2-BWS-grasslands",
  ...overrides,
});

const gasOutboxDoc = (overrides = {}) => ({
  _id: OBJECT_ID,
  target: "arn:aws:sns:eu-west-2:000000000000:cw__sns__update_status_fifo.fifo",
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
  source: "GAS",
  segregationRef: "ref-9",
  status: "PROCESSING",
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  completionAttempts: 3,
  maxAttempts: 7,
  createdAt: "2026-06-16T10:00:00.000Z",
  lastFailureAt: null,
  completedAt: null,
  ...overrides,
});

const cwOutboxRow = (overrides = {}) => ({
  _id: HEX_ID,
  eventId: "evt-9",
  type: "cloud.defra.prd.fg-cw-backend.case.status.updated",
  auditEntities: null,
  target: "arn:aws:sns:eu-west-2:000000000000:cw__sns__audit_topic",
  segregationRef: "ref-9",
  status: "COMPLETED",
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  completionAttempts: 1,
  maxAttempts: 7,
  createdAt: "2026-06-16T10:00:00.000Z",
  lastFailureAt: null,
  completedAt: "2026-06-16T10:01:00.000Z",
  ...overrides,
});

const gasInboxTuple = (overrides) =>
  toEventTuple({
    key: "gasInbox",
    service: "gas",
    box: "inbox",
    intermediate: normaliseGasInbox(gasInboxDoc(overrides), GAS_INBOX_MAX),
  });

const gasOutboxTuple = (overrides) =>
  toEventTuple({
    key: "gasOutbox",
    service: "gas",
    box: "outbox",
    intermediate: normaliseGasOutbox(gasOutboxDoc(overrides), GAS_OUTBOX_MAX),
  });

const cwInboxTuple = (overrides) =>
  toEventTuple({
    key: "cwInbox",
    service: "caseworking",
    box: "inbox",
    intermediate: normaliseCwInbox(cwInboxRow(overrides)),
  });

const cwOutboxTuple = (overrides) =>
  toEventTuple({
    key: "cwOutbox",
    service: "caseworking",
    box: "outbox",
    intermediate: normaliseCwOutbox(cwOutboxRow(overrides)),
  });

describe("map-event-row", () => {
  it("maps a GAS outbox CloudEvent row: eventId from event.id, namespace stripped from type, full type preserved in fullType", () => {
    const { row } = gasOutboxTuple();

    expect(row).toEqual({
      service: "gas",
      box: "outbox",
      id: HEX_ID,
      eventId: "evt-1",
      type: "case.status.updated",
      fullType: "cloud.defra.prd.fg-gas-backend.case.status.updated",
      source: null,
      target: "cw__sns__update_status_fifo.fifo",
      segregationRef: "GLD-9B2-BWS-grasslands",
      status: "PUBLISHED",
      attempts: 2,
      maxAttempts: GAS_OUTBOX_MAX,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      createdAt: "2026-06-16T10:00:00.000Z",
      lastFailureAt: null,
      lastError: null,
      completedAt: null,
    });
  });

  it("maps a GAS inbox row: eventId from messageId, source AS, target null", () => {
    const { row } = gasInboxTuple();

    expect(row.eventId).toEqual("msg-1");
    expect(row.type).toEqual("case.status.updated");
    expect(row.source).toEqual("AS");
    expect(row.target).toBeNull();
    expect(row.box).toEqual("inbox");
  });

  it("maps a CW inbox wire row: hex _id passed through, createdAt used verbatim as the cursor value", () => {
    const tuple = cwInboxTuple({ createdAt: "2026-06-16T10:00:00Z" });

    expect(tuple.id).toEqual(HEX_ID);
    expect(tuple.cursorValue).toEqual("2026-06-16T10:00:00Z");
    expect(tuple.row.id).toEqual(HEX_ID);
    expect(tuple.row.eventId).toEqual("msg-9");
    expect(tuple.row.service).toEqual("caseworking");
  });

  it("maps a CW outbox wire row: reduces the raw ARN to a topic name", () => {
    const { row } = cwOutboxTuple();

    expect(row.target).toEqual("cw__sns__audit_topic");
    expect(row.source).toBeNull();
    expect(row.completedAt).toEqual("2026-06-16T10:01:00.000Z");
  });

  it("keeps a legacy io.onsite.agreement.status.updated type whole in both type and fullType", () => {
    const { row } = gasOutboxTuple({
      event: { id: "evt-1", type: "io.onsite.agreement.status.updated" },
    });

    expect(row.type).toEqual("io.onsite.agreement.status.updated");
    expect(row.fullType).toEqual("io.onsite.agreement.status.updated");
  });

  it("keeps a legacy io.onsite.agreement.create-payment type whole", () => {
    const { row } = gasOutboxTuple({
      event: { id: "evt-1", type: "io.onsite.agreement.create-payment" },
    });

    expect(row.type).toEqual("io.onsite.agreement.create-payment");
  });

  // An audit record is not a CloudEvent: it genuinely has no type, so nothing
  // is synthesised for it. It goes through the SAME derivation as every other
  // row and simply comes out null, which the frontend renders as an absence.
  it("derives a null type and fullType for a GAS audit outbox row", () => {
    const { row } = gasOutboxTuple({
      event: {
        audit: {
          entities: [{ entity: "APPLICATION", action: "SUBMIT_APPLICATION" }],
        },
      },
    });

    expect(row.type).toBeNull();
    expect(row.fullType).toBeNull();
  });

  it("derives the same for a CW audit row, which carries no type either", () => {
    const { row } = cwOutboxTuple({ eventId: null, type: null });

    expect(row.type).toBeNull();
    expect(row.fullType).toBeNull();
  });

  // Nothing about a row's audit-ness is read any more: the entities array is
  // never looked at, and a row carrying one is mapped like any other.
  it("never reads auditEntities, on either wire shape", () => {
    const entities = [{ entity: "APPLICATION", action: "SUBMIT_APPLICATION" }];

    expect(
      cwOutboxTuple({ type: null, auditEntities: entities }).row.type,
    ).toBeNull();
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

  it("returns a null type for an audit row with an empty entities array, and still returns the row", () => {
    const { row } = gasOutboxTuple({ event: { audit: { entities: [] } } });

    expect(row.type).toBeNull();
    expect(row.fullType).toBeNull();
    expect(row.id).toEqual(HEX_ID);
  });

  it("returns a null type for an outbox row with no stored type at all", () => {
    const { row } = gasOutboxTuple({ event: { id: "evt-1" } });

    expect(row.type).toBeNull();
    expect(row.fullType).toBeNull();
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
    const { row } = gasOutboxTuple({ target: "internal:message-bus" });

    expect(row.target).toEqual("internal");
  });

  it("reduces a .fifo SNS ARN to its topic name and never emits a full ARN", () => {
    const { row } = gasOutboxTuple({
      target:
        "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_payment_fifo.fifo",
    });

    expect(row.target).toEqual("gas__sns__create_payment_fifo.fifo");
    expect(JSON.stringify(row)).not.toContain("arn:aws");
  });

  it("falls back to the _id timestamp when eventTime is null", () => {
    const tuple = gasInboxTuple({ eventTime: null });

    expect(tuple.cursorValue).toBeNull();
    expect(tuple.row.createdAt).toEqual(ID_TIMESTAMP);
  });

  it("falls back to the _id timestamp when publicationDate is an unparsable string", () => {
    const tuple = gasOutboxTuple({ publicationDate: "not a date" });

    expect(tuple.row.createdAt).toEqual(ID_TIMESTAMP);
  });

  it("keeps order null while createdAt shows the _id fallback", () => {
    const tuple = gasInboxTuple({ eventTime: null });

    expect(tuple.order).toBeNull();
    expect(tuple.row.createdAt).toEqual(ID_TIMESTAMP);
  });

  it("uses the raw stored eventTime string as the cursor value without canonicalising it", () => {
    const tuple = gasInboxTuple({ eventTime: "2026-06-16T10:00:00Z" });

    expect(tuple.cursorValue).toEqual("2026-06-16T10:00:00Z");
    expect(tuple.row.createdAt).toEqual("2026-06-16T10:00:00.000Z");
  });

  it("uses an ISO string for the outbox cursor value when publicationDate is a Date", () => {
    const tuple = gasOutboxTuple();

    expect(tuple.cursorValue).toEqual("2026-06-16T10:00:00.000Z");
  });

  it("uses GAS config for GAS maxAttempts and CW's per-row maxAttempts for CW rows", () => {
    expect(gasInboxTuple().row.maxAttempts).toEqual(GAS_INBOX_MAX);
    expect(gasOutboxTuple().row.maxAttempts).toEqual(GAS_OUTBOX_MAX);
    expect(cwInboxTuple().row.maxAttempts).toEqual(7);
    expect(cwOutboxTuple({ maxAttempts: 9 }).row.maxAttempts).toEqual(9);
  });

  it("returns null lastFailureAt for a FAILED row with no lastResubmissionDate", () => {
    const { row } = gasInboxTuple({
      status: "FAILED",
      lastResubmissionDate: null,
    });

    expect(row.status).toEqual("FAILED");
    expect(row.lastFailureAt).toBeNull();
  });

  it("normalises GAS timestamp strings to ISO", () => {
    const { row } = gasInboxTuple({
      lastResubmissionDate: "2026-06-16T10:16:05Z",
      completionDate: "2026-06-16T10:20:00Z",
    });

    expect(row.lastFailureAt).toEqual("2026-06-16T10:16:05.000Z");
    expect(row.completedAt).toEqual("2026-06-16T10:20:00.000Z");
  });

  it("produces a row that satisfies the response schema", () => {
    const events = [
      gasInboxTuple().row,
      gasOutboxTuple().row,
      cwInboxTuple().row,
      cwOutboxTuple().row,
      gasOutboxTuple({ event: { audit: { entities: [] } } }).row,
      gasInboxTuple({ eventTime: null }).row,
    ];

    const { error } = findEventsResponseSchema.validate({
      events,
      pagination: {
        startCursor: null,
        endCursor: null,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      sourceErrors: [],
    });

    expect(error).toBeUndefined();
  });

  it("extracts the 32-hex trace-id from a W3C traceparent on a GAS inbox row", () => {
    const { row } = gasInboxTuple();

    expect(row.traceId).toEqual("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("extracts the trace-id from a GAS outbox event.traceparent", () => {
    const { row } = gasOutboxTuple();

    expect(row.traceId).toEqual("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("extracts the trace-id from a pre-flattened CW inbox row", () => {
    const { row } = cwInboxTuple();

    expect(row.traceId).toEqual("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("extracts the trace-id from a pre-flattened CW outbox row", () => {
    const { row } = cwOutboxTuple();

    expect(row.traceId).toEqual("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("accepts an upper-case W3C traceparent", () => {
    const { row } = cwInboxTuple({
      traceparent: "00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01",
    });

    expect(row.traceId).toEqual("4BF92F3577B34DA6A3CE929D0E0E4736");
  });

  it("passes a bare CDP request id through as the trace id", () => {
    const { row } = gasInboxTuple({ traceparent: "1a2b3c4d5e6f" });

    expect(row.traceId).toEqual("1a2b3c4d5e6f");
  });

  it("passes a traceparent whose trace-id is the wrong length through unchanged", () => {
    const { row } = gasInboxTuple({ traceparent: "00-deadbeef-0011-01" });

    expect(row.traceId).toEqual("00-deadbeef-0011-01");
  });

  it("derives a null traceId when the row carries no traceparent", () => {
    const { row } = gasInboxTuple({ traceparent: undefined });

    expect(row.traceId).toBeNull();
  });

  it("derives a null traceId from a null traceparent", () => {
    const { row } = cwOutboxTuple({ traceparent: null });

    expect(row.traceId).toBeNull();
  });

  it("derives a null traceId from an empty traceparent", () => {
    const { row } = cwOutboxTuple({ traceparent: "" });

    expect(row.traceId).toBeNull();
  });

  it("derives a null traceId for a GAS audit row and never reads its correlationid", () => {
    const { row } = gasOutboxTuple({
      event: {
        audit: {
          entities: [{ entity: "APPLICATION", action: "SUBMIT_APPLICATION" }],
        },
        correlationid: "d0f7b2a4-1111-2222-3333-444455556666",
      },
    });

    expect(row.traceId).toBeNull();
    expect(JSON.stringify(row)).not.toContain("d0f7b2a4");
  });

  it("derives a null traceId for a CW audit row", () => {
    const { row } = cwOutboxTuple({
      eventId: null,
      type: null,
      traceparent: null,
      auditEntities: [{ entity: "CASE", action: "VIEW_CASE_LIST" }],
    });

    expect(row.traceId).toBeNull();
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

  it("takes only traceparent from an event that also carries a payload", () => {
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

    expect(row.traceId).toEqual("4bf92f3577b34da6a3ce929d0e0e4736");
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

  it("is null on every source when the document has no lastError", () => {
    expect(gasInboxTuple().row.lastError).toBeNull();
    expect(gasOutboxTuple().row.lastError).toBeNull();
    expect(cwInboxTuple().row.lastError).toBeNull();
    expect(cwOutboxTuple().row.lastError).toBeNull();
  });

  it("passes a GAS inbox lastError through unchanged", () => {
    expect(gasInboxTuple({ lastError }).row.lastError).toEqual(lastError);
  });

  it("passes a GAS outbox lastError through unchanged", () => {
    expect(gasOutboxTuple({ lastError }).row.lastError).toEqual(lastError);
  });

  it("passes a Caseworking lastError through unchanged", () => {
    expect(cwInboxTuple({ lastError }).row.lastError).toEqual(lastError);
    expect(cwOutboxTuple({ lastError }).row.lastError).toEqual(lastError);
  });

  it("rebuilds a lastError missing its name and message rather than failing the page", () => {
    const row = gasOutboxTuple({
      lastError: { at: "2026-06-16T10:16:05.000Z" },
    }).row;

    expect(row.lastError).toEqual({
      name: "Error",
      message: "",
      at: "2026-06-16T10:16:05.000Z",
    });
  });

  it("returns a null at for an unparseable stored timestamp", () => {
    const row = gasOutboxTuple({
      lastError: { name: "Error", message: "boom", at: "not-a-date" },
    }).row;

    expect(row.lastError.at).toBeNull();
  });

  it("drops any extra key a stored lastError carries", () => {
    const row = gasOutboxTuple({
      lastError: { ...lastError, stack: "SECRET-STACK" },
    }).row;

    expect(Object.keys(row.lastError)).toEqual(["name", "message", "at"]);
  });

  it("validates a row carrying a lastError against the response schema", () => {
    const { error } = findEventsResponseSchema.validate({
      events: [gasOutboxTuple({ lastError }).row],
      pagination: {
        startCursor: null,
        endCursor: null,
        hasNextPage: false,
        hasPreviousPage: false,
      },
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

  it("rebuilds each entry from at, name and message only", () => {
    expect(
      toAttemptHistory([
        {
          at: "2026-06-16T10:05:00.000Z",
          name: "TypeError",
          message: "boom",
          stack: "SECRET-STACK",
        },
      ]),
    ).toEqual([
      { at: "2026-06-16T10:05:00.000Z", name: "TypeError", message: "boom" },
    ]);
  });

  it("normalises a Date at into an ISO string and an unparseable one into null", () => {
    expect(
      toAttemptHistory([{ at: new Date("2026-06-16T10:05:00.000Z") }]).at(0).at,
    ).toBe("2026-06-16T10:05:00.000Z");
    expect(toAttemptHistory([{ at: "not a date" }]).at(0).at).toBeNull();
  });

  it("defaults a missing name to Error and a missing message to empty", () => {
    expect(toAttemptHistory([{}])).toEqual([
      { at: null, name: "Error", message: "" },
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
