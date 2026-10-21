import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { eventRowWithAttemptsSchema } from "../schemas/events-shared.schema.js";
import {
  normaliseGasInbox,
  normaliseGasOutbox,
  toAttemptHistory,
  toEventRow,
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

const gasInboxParts = (overrides) => ({
  key: "gasInbox",
  service: "gas",
  box: "inbox",
  intermediate: normaliseGasInbox(gasInboxDoc(overrides), GAS_INBOX_MAX),
});

const gasInboxSingle = (overrides) => toEventRow(gasInboxParts(overrides));

const AUDIT_ARN =
  "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn";

const gasOutboxParts = (overrides) => ({
  key: "gasOutbox",
  service: "gas",
  box: "outbox",
  intermediate: normaliseGasOutbox(gasOutboxDoc(overrides), GAS_OUTBOX_MAX),
});

const gasOutboxSingle = (overrides) => toEventRow(gasOutboxParts(overrides));

describe("map-event-row", () => {
  it("maps a GAS outbox row: eventId from event.id, namespace stripped from type", () => {
    expect(gasOutboxSingle()).toEqual({
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
      attempts: "2/5",
      targetTopic: "gas__sns__update_case_status_fifo.fifo",
      lastError: null,
    });
  });

  it("falls back to the _id timestamp when an inbox publicationDate is null", () => {
    expect(gasInboxSingle({ publicationDate: null }).createdAt).toEqual(
      ID_TIMESTAMP,
    );
  });

  it("falls back to the _id timestamp when publicationDate is an unparsable string", () => {
    expect(gasInboxSingle({ publicationDate: "not-a-date" }).createdAt).toEqual(
      ID_TIMESTAMP,
    );
  });

  it("dates an inbox row by its publicationDate, never its eventTime", () => {
    const row = gasInboxSingle({
      publicationDate: "2026-06-16T10:00:00.123Z",
      eventTime: "2026-06-16T09:00:00.000Z",
    });

    expect(row.createdAt).toEqual("2026-06-16T10:00:00.123Z");
  });

  it("produces a row that satisfies the response schema", () => {
    for (const row of [gasInboxSingle(), gasOutboxSingle()]) {
      expect(eventRowWithAttemptsSchema.validate(row).error).toBeUndefined();
    }
  });

  it("maps a GAS inbox row: eventId from messageId, and no topic of its own", () => {
    const row = gasInboxSingle();

    expect(row.eventId).toEqual("msg-1");
    expect(row.type).toEqual("case.status.updated");
    expect(row.box).toEqual("inbox");
    expect(gasInboxSingle().targetTopic).toBeNull();
  });

  it("keeps a legacy io.onsite.agreement.status.updated type whole", () => {
    const row = gasOutboxSingle({
      event: { id: "evt-1", type: "io.onsite.agreement.status.updated" },
    });

    expect(row.type).toEqual("io.onsite.agreement.status.updated");
  });

  it("keeps a legacy io.onsite.agreement.create-payment type whole", () => {
    const row = gasOutboxSingle({
      event: { id: "evt-1", type: "io.onsite.agreement.create-payment" },
    });

    expect(row.type).toEqual("io.onsite.agreement.create-payment");
  });

  it("labels a GAS audit outbox row audit", () => {
    const row = gasOutboxSingle({
      target: AUDIT_ARN,
      event: {
        audit: {
          entities: [{ entity: "APPLICATION", action: "SUBMIT_APPLICATION" }],
        },
      },
    });

    expect(row.type).toBe("audit");
  });

  it("falls back to _id for eventId on an audit row", () => {
    const row = gasOutboxSingle({
      event: { audit: { entities: [{ entity: "GRANT", action: "CREATE" }] } },
    });

    expect(row.eventId).toEqual(HEX_ID);
  });

  it("labels an audit row with an empty entities array, and still returns the row", () => {
    const row = gasOutboxSingle({
      target: AUDIT_ARN,
      event: { audit: { entities: [] } },
    });

    expect(row.type).toBe("audit");
    expect(row.id).toEqual(HEX_ID);
  });

  it("labels a type-less row on another topic unknown", () => {
    const row = gasOutboxSingle({ event: { id: "evt-1" } });

    expect(row.type).toBe("unknown");
  });

  it("labels a type-less row on the audit topic audit", () => {
    const row = gasOutboxSingle({
      target: AUDIT_ARN,
      event: { id: "evt-1" },
    });

    expect(row.type).toBe("audit");
  });

  it("labels a type-less inbox row unknown, never audit", () => {
    const row = gasInboxSingle({ type: null });

    expect(row.type).toBe("unknown");
  });

  it("never labels a row audit just because its type shortens to nothing", () => {
    const row = gasOutboxSingle({
      event: { id: "evt-1", type: "cloud.defra.prd.fg-gas-backend." },
    });

    expect(row.type).toBe("cloud.defra.prd.fg-gas-backend.");
  });

  it("never reads entityid or details from an audit entity", () => {
    const row = gasOutboxSingle({
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

  it.each(["internal:message-bus", "internal:event"])(
    "reduces %s to internal rather than exposing its target name",
    (target) => {
      expect(gasOutboxSingle({ target }).targetTopic).toEqual("internal");
    },
  );

  it("reduces a .fifo SNS ARN to its topic name and never emits a full ARN", () => {
    const target = "arn:aws:sns:eu-west-2:000000000000:create_payment.fifo";

    expect(gasOutboxSingle({ target }).targetTopic).toEqual(
      "create_payment.fifo",
    );
    expect(JSON.stringify(gasOutboxSingle({ target }))).not.toContain(
      "arn:aws",
    );
    expect(JSON.stringify(gasOutboxSingle({ target }))).not.toContain(
      "arn:aws",
    );
  });

  it("takes the attempts ceiling from GAS config", () => {
    expect(gasInboxSingle().attempts).toEqual(`1/${GAS_INBOX_MAX}`);
    expect(gasOutboxSingle().attempts).toEqual(`2/${GAS_OUTBOX_MAX}`);
  });

  it("never reads an audit row's correlationid", () => {
    const row = gasOutboxSingle({
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
    const row = gasOutboxSingle({
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
    const row = gasOutboxSingle({
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
