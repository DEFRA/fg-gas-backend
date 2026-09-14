import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { findEventsResponseSchema } from "../schemas/find-events-response.schema.js";
import {
  normaliseCwInbox,
  normaliseCwOutbox,
  normaliseGasInbox,
  normaliseGasOutbox,
  toAttemptHistory,
  toEventRow,
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

// A topic this service actually publishes, and one Caseworking subscribes a
// queue to, so the row's queue line names a real destination.
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
  // Caseworking's own audit topic, spelled the way that estate spells it.
  target: "arn:aws:sns:eu-west-2:000000000000:cw__sns__audit_fifo",
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

const gasInboxParts = (overrides) => ({
  key: "gasInbox",
  service: "gas",
  box: "inbox",
  intermediate: normaliseGasInbox(gasInboxDoc(overrides), GAS_INBOX_MAX),
});

const gasInboxTuple = (overrides) => toEventTuple(gasInboxParts(overrides));

// The single-row shape behind the detail and redrive answers. It is the only
// shape carrying the attempt facts, so that is where they are asserted.
const gasInboxSingle = (overrides) => toEventRow(gasInboxParts(overrides));

// The topic write-audit-event.js addresses, matching the unit-test env's
// GAS__SNS__AUDIT_TOPIC_ARN.
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
  intermediate: normaliseCwInbox(cwInboxRow(overrides)),
});

const cwInboxTuple = (overrides) => toEventTuple(cwInboxParts(overrides));

const cwInboxSingle = (overrides) => toEventRow(cwInboxParts(overrides));

const cwOutboxParts = (overrides) => ({
  key: "cwOutbox",
  service: "caseworking",
  box: "outbox",
  intermediate: normaliseCwOutbox(cwOutboxRow(overrides)),
});

const cwOutboxTuple = (overrides) => toEventTuple(cwOutboxParts(overrides));

const cwOutboxSingle = (overrides) => toEventRow(cwOutboxParts(overrides));

describe("map-event-row", () => {
  it("maps a GAS outbox CloudEvent row: eventId from event.id, namespace stripped from type, the hop and queue it names", () => {
    const { row } = gasOutboxTuple();

    expect(row).toEqual({
      service: "gas",
      box: "outbox",
      id: HEX_ID,
      eventId: "evt-1",
      type: "case.status.updated",
      hop: "GAS Outbox",
      queue: "to Caseworking",
      queueValue: "gas__sns__update_case_status_fifo.fifo",
      status: "PUBLISHED",
      statusLabel: "Published",
      statusRole: "neutral",
      statusRetrying: false,
      createdAt: "2026-06-16T10:00:00.000Z",
      lastError: null,
      latency: null,
      latencyTitle: "Queued to delivered to SNS",
    });
  });

  it("maps a GAS inbox row: eventId from messageId, a queue line naming the producer", () => {
    const { row } = gasInboxTuple();

    expect(row.eventId).toEqual("msg-1");
    expect(row.type).toEqual("case.status.updated");
    expect(row.hop).toEqual("GAS Inbox");
    expect(row.queue).toEqual("from Agreements");
    expect(row.queueValue).toBeNull();
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

    expect(row.hop).toEqual("CW Outbox");
    expect(row.queueValue).toEqual("cw__sns__audit_fifo");
    expect(row.queue).toEqual("to Audit");
    expect(row.latency).toEqual("1m 0s");
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

  // A blank type would look like "no type recorded" to the label rule - see
  // shortType in map-event-row.js.
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
    const { row } = gasOutboxTuple({ target: "internal:message-bus" });

    expect(row.queueValue).toEqual("internal");
    expect(row.queue).toEqual("to GAS");
  });

  it("reduces a .fifo SNS ARN to its topic name and never emits a full ARN", () => {
    const { row } = gasOutboxTuple({
      target:
        "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_payment_fifo.fifo",
    });

    expect(row.queueValue).toEqual("gas__sns__create_payment_fifo.fifo");
    expect(row.queue).toEqual("to Payments");
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

  it("takes the attempts ceiling from GAS config for GAS rows and from the row itself for CW rows", () => {
    expect(gasInboxSingle().attempts).toEqual(`1/${GAS_INBOX_MAX}`);
    expect(gasOutboxSingle().attempts).toEqual(`2/${GAS_OUTBOX_MAX}`);
    expect(cwInboxSingle().attempts).toEqual("3/7");
    expect(cwOutboxSingle({ maxAttempts: 9 }).attempts).toEqual("1/9");
  });

  it("draws the attempts figure only where it is news", () => {
    expect(gasInboxSingle().showAttempts).toBe(false);
    expect(gasOutboxSingle().showAttempts).toBe(true);
    expect(
      gasInboxSingle({
        status: "DEAD_LETTER",
        lastResubmissionDate: "2026-06-16T10:16:05Z",
      }).showAttempts,
    ).toBe(true);
  });

  it("keeps the attempt facts off the list row, which draws none of them", () => {
    const { row } = gasOutboxTuple();

    expect(row).not.toHaveProperty("attempts");
    expect(row).not.toHaveProperty("showAttempts");
    expect(row).not.toHaveProperty("lastFailureAt");
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

  it("returns null lastFailureAt for a FAILED row with no lastResubmissionDate", () => {
    const row = gasInboxSingle({
      status: "FAILED",
      lastResubmissionDate: null,
    });

    expect(row.status).toEqual("FAILED");
    expect(row.lastFailureAt).toBeNull();
  });

  it("normalises GAS timestamp strings to ISO", () => {
    const overrides = {
      lastResubmissionDate: "2026-06-16T10:16:05Z",
      completionDate: "2026-06-16T10:20:00Z",
    };

    expect(gasInboxSingle(overrides).lastFailureAt).toEqual(
      "2026-06-16T10:16:05.000Z",
    );
    expect(gasInboxTuple(overrides).row.latency).toEqual("20m 0s");
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

  it("carries no trace id at all", () => {
    expect(gasInboxTuple().row).not.toHaveProperty("traceId");
    expect(gasOutboxTuple().row).not.toHaveProperty("traceId");
    expect(cwInboxTuple().row).not.toHaveProperty("traceId");
    expect(cwOutboxTuple().row).not.toHaveProperty("traceId");
  });

  // An audit payload's `correlationid` is a different identifier from a trace
  // and is deliberately never read, here or anywhere.
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
      fullType: "Audit record — not a CloudEvent",
    });

    expect(row.type).toEqual("audit");
    expect(row).not.toHaveProperty("fullType");
  });

  it("takes an unknown label Caseworking derived", () => {
    const { row } = cwInboxTuple({
      type: "unknown",
      fullType: "No event type recorded — not a CloudEvent",
    });

    expect(row.type).toEqual("unknown");
  });

  it("still strips the namespace off a real Caseworking type", () => {
    const { row } = cwInboxTuple({
      type: "cloud.defra.prd.fg-cw-backend.case.status.updated",
      fullType: "cloud.defra.prd.fg-cw-backend.case.status.updated",
    });

    expect(row.type).toEqual("case.status.updated");
  });

  // A Caseworking that has not grown the labels yet sends no type at all.
  it("falls back to unknown for a Caseworking that sends no type", () => {
    expect(cwInboxTuple({ type: null }).row.type).toEqual("unknown");
  });
});

describe("the journey hop beside each row", () => {
  it("carries the hop's own columns and nothing the table has no room for", () => {
    const { hop } = gasOutboxTuple();

    expect(hop).toEqual({
      service: "gas",
      box: "outbox",
      id: HEX_ID,
      hop: "GAS Outbox",
      status: "PUBLISHED",
      statusLabel: "Published",
      statusRole: "neutral",
      statusRetrying: false,
      startedAt: "2026-06-16T10:00:00.000Z",
      took: null,
    });
  });

  it("times an inbox hop from the receipt, where the row times itself from the event", () => {
    const tuple = gasInboxTuple({
      publicationDate: "2026-06-16T10:00:02.000Z",
      completionDate: "2026-06-16T10:00:03.500Z",
    });

    expect(tuple.hop.startedAt).toEqual("2026-06-16T10:00:02.000Z");
    expect(tuple.hop.took).toEqual("1.5s");
    expect(tuple.row.latency).toEqual("3.5s");
  });

  it("falls back to createdAt for an inbox hop with no receipt instant", () => {
    const { hop } = cwInboxTuple();

    expect(hop.hop).toEqual("CW Inbox");
    expect(hop.startedAt).toEqual("2026-06-16T10:00:00.000Z");
  });
});
