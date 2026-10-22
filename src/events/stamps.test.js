import { describe, expect, it, vi } from "vitest";
import { INBOX, OUTBOX, defineEventType } from "./event-types.js";
import {
  STAMPED_FIELDS,
  auditStamps,
  backfillInboxStamps,
  backfillOutboxStamps,
  inboxStamps,
  outboxStamps,
  withoutStamps,
} from "./stamps.js";

vi.mock("../common/config.js", () => ({
  config: {
    sns: { auditTopicArn: "arn:aws:sns:eu-west-2:000000000000:audit-topic" },
  },
}));

const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const TRACE_REF = "trace:4bf92f3577b34da6a3ce929d0e0e4736";

const sent = defineEventType({
  name: "test.sent",
  sentAs: "cloud.defra.test.fg-gas-backend.test.sent",
  boxes: [OUTBOX],
  refs: ({ data }) => [["ref", data?.clientRef]],
});

defineEventType({
  name: "test.received",
  sentAs: "cloud.defra.test.fg-cw-backend.test.received",
  boxes: [INBOX],
  refs: ({ data }) => [["ref", data?.caseRef]],
});

defineEventType({
  name: "test.report",
  recognise: ({ eventData }) => eventData?.eventType === "REPORT",
  boxes: [OUTBOX],
});

const event = (overrides) => ({
  id: "0B7C1D1E-0000-4000-8000-000000000001",
  type: sent.sentAs,
  traceparent: TRACEPARENT,
  data: { code: "example-grant", clientRef: "ABC-123" },
  ...overrides,
});

const message = (overrides) => ({
  id: "0b7c1d1e-0000-4000-8000-000000000002",
  type: "cloud.defra.test.fg-cw-backend.test.received",
  traceparent: "not-a-w3c-trace",
  data: { workflowCode: "example-grant", caseRef: "ABC-123" },
  ...overrides,
});

const auditPayload = (overrides) => ({
  user: "5F0C2A9E-0000-4000-8000-000000000003",
  correlationid: "trace-id-1",
  audit: {
    entities: [
      { entity: "APPLICATION", action: "SUBMIT", entityid: "ABC-123" },
      { entity: "AGREEMENT", action: "CREATE", entityid: "FPTT000000001" },
    ],
  },
  ...overrides,
});

describe("STAMPED_FIELDS", () => {
  it("names every field a writer stamps at insert", () => {
    expect(STAMPED_FIELDS).toEqual(["eventType", "refs"]);
  });
});

describe("outboxStamps", () => {
  it("stamps a declared type with its name and refs", () => {
    expect(outboxStamps(event(), { segregationRef: "FPTT000000001" })).toEqual({
      eventType: "test.sent",
      refs: [
        "ref:abc-123",
        "id:0b7c1d1e-0000-4000-8000-000000000001",
        TRACE_REF,
      ],
    });
  });

  it("adds the refs the writer gives after the type's own, dropping empty ones", () => {
    expect(
      outboxStamps(event(), {
        segregationRef: "ABC-123",
        refs: [
          ["application", "example-grant:~41.~42.~43.-123"],
          ["application", null],
        ],
      }).refs,
    ).toEqual([
      "ref:abc-123",
      "application:example-grant:~41.~42.~43.-123",
      "id:0b7c1d1e-0000-4000-8000-000000000001",
      TRACE_REF,
    ]);
  });

  it("stamps only the refs the envelope has", () => {
    expect(
      outboxStamps(event({ data: {}, traceparent: undefined }), {}),
    ).toEqual({
      eventType: "test.sent",
      refs: ["id:0b7c1d1e-0000-4000-8000-000000000001"],
    });
  });

  it("recognises an envelope that travels with no type", () => {
    expect(outboxStamps({ eventData: { eventType: "REPORT" } }, {})).toEqual({
      eventType: "test.report",
      refs: [],
    });
  });

  it("throws for a type nobody declared", () => {
    expect(() =>
      outboxStamps(event({ type: "cloud.defra.test.other" }), {}),
    ).toThrow('Event type "cloud.defra.test.other" is not declared');
  });

  it("throws for a type declared only for the inbox", () => {
    expect(() => outboxStamps(message(), {})).toThrow("is not declared");
  });

  it("matches the environment exactly", () => {
    expect(() =>
      outboxStamps(
        event({ type: "cloud.defra.prod.fg-gas-backend.test.sent" }),
        {},
      ),
    ).toThrow("is not declared");
  });
});

describe("inboxStamps", () => {
  it("stamps a declared type", () => {
    expect(inboxStamps(message(), { segregationRef: "abc-123-grant" })).toEqual(
      {
        eventType: "test.received",
        refs: [
          "ref:abc-123",
          "id:0b7c1d1e-0000-4000-8000-000000000002",
          "trace:not-a-w3c-trace",
        ],
      },
    );
  });

  it.each([
    ["a type nobody declared", { type: "io.example.unknown" }],
    ["a type declared only for the outbox", { type: sent.sentAs }],
    ["no type at all", { type: undefined }],
  ])("stamps %s unrecognised", (_, overrides) => {
    expect(inboxStamps(message(overrides), {})).toEqual({
      eventType: "Unrecognised",
      refs: [
        "id:0b7c1d1e-0000-4000-8000-000000000002",
        "trace:not-a-w3c-trace",
      ],
    });
  });
});

describe("auditStamps", () => {
  it("refs only the trace", () => {
    expect(auditStamps(auditPayload())).toEqual({
      eventType: "Audit",
      refs: ["trace:trace-id-1"],
    });
  });

  it("stamps a payload with no trace with no refs", () => {
    expect(auditStamps({})).toEqual({
      eventType: "Audit",
      refs: [],
    });
  });
});

describe("backfillOutboxStamps", () => {
  it("stamps a row sent to the audit topic as audit", () => {
    const stamps = backfillOutboxStamps({
      target: "arn:aws:sns:eu-west-2:111111111111:audit-topic",
      event: auditPayload(),
    });

    expect(stamps).toMatchObject({ eventType: "Audit" });
  });

  it("matches a message with the environment segment ignored", () => {
    const stamps = backfillOutboxStamps({
      target: "arn:aws:sns:eu-west-2:111111111111:some-topic",
      segregationRef: "FPTT000000001",
      event: event({ type: "cloud.defra.prod.fg-gas-backend.test.sent" }),
    });

    expect(stamps).toEqual({
      eventType: "test.sent",
      refs: [
        "ref:abc-123",
        "id:0b7c1d1e-0000-4000-8000-000000000001",
        TRACE_REF,
      ],
    });
  });

  it("reads the envelope as it was written, not as it was edited", () => {
    const stamps = backfillOutboxStamps({
      target: "some-topic",
      originalPayload: event(),
      event: event({ type: "edited", data: { clientRef: "EDITED" } }),
    });

    expect(stamps.eventType).toBe("test.sent");
    expect(stamps.refs).toContain("ref:abc-123");
  });

  it.each([
    ["a type nobody declares", { event: event({ type: "retired.type" }) }],
    ["a type declared only for the inbox", { event: message() }],
    ["a row with no envelope", {}],
  ])("stamps %s unrecognised and never skips it", (_, doc) => {
    expect(
      backfillOutboxStamps({ target: "some-topic", ...doc }),
    ).toMatchObject({
      eventType: "Unrecognised",
    });
  });
});

describe("backfillInboxStamps", () => {
  it("takes the event id from the envelope and the trace from the row's own column", () => {
    const stamps = backfillInboxStamps({
      messageId: "MSG-1",
      traceparent: TRACEPARENT,
      type: "edited-type",
      event: message({
        traceparent: "ignored",
        type: "cloud.defra.prod.fg-cw-backend.test.received",
      }),
    });

    expect(stamps).toEqual({
      eventType: "test.received",
      refs: [
        "ref:abc-123",
        "id:0b7c1d1e-0000-4000-8000-000000000002",
        TRACE_REF,
      ],
    });
  });

  it("stamps a type nobody declares unrecognised, with the refs it has", () => {
    expect(
      backfillInboxStamps({
        messageId: "MSG-1",
        event: message({ type: "io.example.retired" }),
      }),
    ).toEqual({
      eventType: "Unrecognised",
      refs: ["id:0b7c1d1e-0000-4000-8000-000000000002"],
    });
  });
});

describe("withoutStamps", () => {
  it("answers the document less every stamped field", () => {
    expect(
      withoutStamps({
        status: "COMPLETED",
        eventType: "test.sent",
        refs: [],
        event: { id: "1" },
      }),
    ).toEqual({ status: "COMPLETED", event: { id: "1" } });
  });
});
