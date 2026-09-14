import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { toEventDetail } from "./map-event-detail.js";

const objectId = new ObjectId("665f1c2e9a1b2c3d4e5f6a7b");
const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

const anInboxDoc = (overrides = {}) => ({
  _id: objectId,
  messageId: "msg-1",
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  segregationRef: "GLD-9B2",
  status: "DEAD_LETTER",
  completionAttempts: 5,
  traceparent: TRACEPARENT,
  eventTime: "2026-06-16T10:00:00.000Z",
  publicationDate: "2026-06-16T10:00:01.000Z",
  lastResubmissionDate: "2026-06-16T10:05:00.000Z",
  completionDate: null,
  lastError: {
    name: "TypeError",
    message: "boom",
    at: "2026-06-16T10:05:00.000Z",
  },
  claimedAt: null,
  claimExpiresAt: null,
  event: {
    id: "evt-1",
    time: "2026-06-16T10:00:00.000Z",
    data: { clientRef: "REF-1" },
  },
  ...overrides,
});

const anOutboxDoc = (overrides = {}) => ({
  _id: objectId,
  target:
    "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case_fifo.fifo",
  segregationRef: "GLD-9B2",
  status: "DEAD_LETTER",
  completionAttempts: 5,
  publicationDate: new Date("2026-06-16T10:00:00.000Z"),
  lastResubmissionDate: null,
  completionDate: "2026-06-16T10:06:00.000Z",
  lastError: null,
  claimedAt: new Date("2026-06-16T10:04:00.000Z"),
  claimExpiresAt: new Date("2026-06-16T10:09:00.000Z"),
  event: {
    id: "evt-2",
    type: "cloud.defra.local.fg-gas-backend.case.create",
    traceparent: TRACEPARENT,
    data: { clientRef: "REF-2" },
  },
  ...overrides,
});

const inboxDetail = (overrides) =>
  toEventDetail({
    service: "gas",
    box: "inbox",
    doc: anInboxDoc(overrides),
    maxAttempts: 5,
  });

const outboxDetail = (overrides) =>
  toEventDetail({
    service: "gas",
    box: "outbox",
    doc: anOutboxDoc(overrides),
    maxAttempts: 5,
  });

// The M3 guard on the detail path. The list's copy of it lives in
// map-event-row.test.js; both matter, because the invariant was once applied
// in one transform and missed in the parallel one - and `lastError` now
// carries a stored stack for every failure, so this is the transform standing
// between that stack and the wire.
describe("toEventDetail lastError", () => {
  it("drops a stored stack, serving the three contract keys", () => {
    const detail = inboxDetail({
      lastError: {
        name: "TypeError",
        message: "boom",
        at: "2026-06-16T10:16:05.000Z",
        stack: "SECRET-STACK",
      },
    });

    expect(Object.keys(detail.lastError)).toEqual(["name", "message", "at"]);
    expect(JSON.stringify(detail)).not.toContain("SECRET-STACK");
  });

  // Attempt stacks ARE served - the attempts section expands to reveal one -
  // while the Last error fact's stack still is not: the fact draws a name, a
  // message and an instant, so that is all it is sent.
  it("serves the attempt's stack while the lastError fact keeps none", () => {
    const detail = inboxDetail({
      lastError: {
        name: "TypeError",
        message: "boom",
        at: "2026-06-16T10:16:05.000Z",
        stack: "LAST-ERROR-STACK",
      },
      attemptHistory: [
        {
          at: "2026-06-16T10:05:00.000Z",
          name: "TypeError",
          message: "boom",
          stack: "ATTEMPT-STACK",
        },
      ],
    });

    expect(detail.attemptHistory[0].stack).toBe("ATTEMPT-STACK");
    expect(Object.keys(detail.lastError)).toEqual(["name", "message", "at"]);
    expect(JSON.stringify(detail)).not.toContain("LAST-ERROR-STACK");
  });
});

// A redrive nobody is named for is the platform's own. The document keeps its
// null - `redriveRecord` writes one and goes on writing one - and only the
// answer names it, so the two cannot drift apart.
describe("toEventDetail lastRedrive", () => {
  it("names an unattributed redrive as the platform's own", () => {
    const doc = anInboxDoc({
      lastRedrive: { at: "2026-06-16T11:05:00.000Z", by: null },
    });

    expect(
      toEventDetail({ service: "gas", box: "inbox", doc, maxAttempts: 5 })
        .lastRedrive,
    ).toEqual({ at: "2026-06-16T11:05:00.000Z", by: "System" });
    // The mapper reads the document; it never rewrites it.
    expect(doc.lastRedrive.by).toBeNull();
  });

  it.each([[undefined], [""], ["   "]])(
    "names a redrive recorded with %p as the platform's own",
    (by) => {
      expect(
        inboxDetail({ lastRedrive: { at: "2026-06-16T11:05:00.000Z", by } })
          .lastRedrive.by,
      ).toBe("System");
    },
  );

  it("keeps a named operator exactly as it was recorded", () => {
    expect(
      inboxDetail({
        lastRedrive: { at: "2026-06-16T11:05:00.000Z", by: "Ada Lovelace" },
      }).lastRedrive.by,
    ).toBe("Ada Lovelace");
  });

  it("stays null on an event nobody has redriven", () => {
    expect(inboxDetail().lastRedrive).toBeNull();
  });
});

describe("toEventDetail inbox", () => {
  it("carries every list row field", () => {
    const detail = inboxDetail();

    expect(detail).toMatchObject({
      service: "gas",
      box: "inbox",
      id: "665f1c2e9a1b2c3d4e5f6a7b",
      eventId: "msg-1",
      type: "case.status.updated",
      hop: "GAS Inbox",
      queue: "from Caseworking",
      queueValue: null,
      segregationRef: "GLD-9B2",
      status: "DEAD_LETTER",
      statusLabel: "Dead letter",
      statusRole: "error",
      statusRetrying: false,
      attempts: "5/5",
      showAttempts: true,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      createdAt: "2026-06-16T10:00:00.000Z",
      lastFailureAt: "2026-06-16T10:05:00.000Z",
    });
  });

  it("carries no latency", () => {
    expect(inboxDetail()).not.toHaveProperty("latency");
    expect(inboxDetail()).not.toHaveProperty("latencyTitle");
  });

  it("adds the full event payload verbatim", () => {
    expect(inboxDetail().payload).toEqual({
      id: "evt-1",
      time: "2026-06-16T10:00:00.000Z",
      data: { clientRef: "REF-1" },
    });
  });

  it("adds the raw traceparent alongside the derived traceId", () => {
    const detail = inboxDetail();

    expect(detail.traceparent).toBe(TRACEPARENT);
    expect(detail.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("lifts the producer's own instant out of the payload", () => {
    expect(inboxDetail().occurredAt).toBe("2026-06-16T10:00:00.000Z");
  });

  it("lifts the FIFO group the event was published under out of the payload", () => {
    expect(
      inboxDetail({ event: { id: "evt-1", messageGroupId: "GLD-9B2" } })
        .messageGroupId,
    ).toBe("GLD-9B2");
  });

  it("has a null occurredAt and messageGroupId where the payload records neither", () => {
    const detail = inboxDetail({ event: { id: "evt-1" } });

    expect(detail.occurredAt).toBeNull();
    expect(detail.messageGroupId).toBeNull();
  });

  it("adds the lifecycle dates", () => {
    const detail = inboxDetail();

    expect(detail.publicationDate).toBe("2026-06-16T10:00:01.000Z");
    expect(detail.lastResubmissionDate).toBe("2026-06-16T10:05:00.000Z");
    expect(detail.completionDate).toBeNull();
  });

  it("never carries a claim token", () => {
    expect(inboxDetail()).not.toHaveProperty("claimedBy");
  });

  it("ignores a claimedBy that somehow reached the mapper", () => {
    expect(inboxDetail({ claimedBy: "claim-token" })).not.toHaveProperty(
      "claimedBy",
    );
  });

  it("carries a null payload when the document has no event", () => {
    expect(inboxDetail({ event: undefined }).payload).toBeNull();
  });
});

describe("toEventDetail outbox", () => {
  // The topic name is what the page draws; the ARN it was cut from went with
  // the copy button that was the only thing carrying it.
  it("keeps the topic name on `queueValue` and sends no raw ARN", () => {
    const detail = outboxDetail();

    expect(detail.queue).toBe("to Caseworking");
    expect(detail.queueValue).toBe("gas__sns__create_new_case_fifo.fifo");
    expect(detail).not.toHaveProperty("targetRaw");
  });

  it("adds the full event payload verbatim", () => {
    expect(outboxDetail().payload.data).toEqual({ clientRef: "REF-2" });
  });

  it("carries none of the three inbox-only fields, even though the document stores them", () => {
    const detail = outboxDetail();

    expect(detail).not.toHaveProperty("segregationRef");
    expect(detail).not.toHaveProperty("traceparent");
    expect(detail).not.toHaveProperty("traceId");
    expect(anOutboxDoc().segregationRef).toBe("GLD-9B2");
    expect(anOutboxDoc().event.traceparent).toBe(TRACEPARENT);
  });

  it("renders Date claim fields as ISO strings", () => {
    const detail = outboxDetail();

    expect(detail.claimedAt).toBe("2026-06-16T10:04:00.000Z");
    expect(detail.claimExpiresAt).toBe("2026-06-16T10:09:00.000Z");
  });

  it("renders a Date publicationDate as an ISO string", () => {
    expect(outboxDetail().publicationDate).toBe("2026-06-16T10:00:00.000Z");
  });

  it("renders a completion date as an ISO string", () => {
    expect(outboxDetail().completionDate).toBe("2026-06-16T10:06:00.000Z");
  });

  it("maps an audit row through the same derivation as every other row", () => {
    const detail = outboxDetail({
      target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn",
      event: {
        datetime: "2026-06-16T10:00:00.000Z",
        audit: {
          entities: [
            {
              entity: "APPLICATION",
              action: "SUBMIT_APPLICATION",
              entityid: "APP-1",
            },
          ],
        },
      },
    });

    expect(detail.type).toBe("audit");
    expect(detail.typeTitle).toBe("Audit record — not a CloudEvent");
    expect(detail.queue).toBe("to Audit");
    // the detail view is the one place the audit payload is returned in full
    expect(detail.payload.audit.entities[0].entityid).toBe("APP-1");
  });
});

describe("toEventDetail caseworking", () => {
  // CW's detail endpoint answers with the whole stored document, which has the
  // same shape as a GAS one, so the same document normalisers map it.
  it("maps a caseworking inbox document with CW's own maxAttempts", () => {
    const detail = toEventDetail({
      service: "caseworking",
      box: "inbox",
      doc: { ...anInboxDoc(), _id: "665f1c2e9a1b2c3d4e5f6a7b" },
      maxAttempts: 7,
    });

    expect(detail.service).toBe("caseworking");
    expect(detail.id).toBe("665f1c2e9a1b2c3d4e5f6a7b");
    expect(detail.hop).toBe("CW Inbox");
    expect(detail.attempts).toBe("5/7");
    expect(detail.payload).toEqual(anInboxDoc().event);
  });

  // Each service is authoritative for its own rows. These labels come from
  // Caseworking's own predicate, applied to its own audit topic, which this
  // service cannot recognise: derived here, a type-less Caseworking audit row
  // listed as "audit" from CW's label and detailed as "unknown".
  it("takes Caseworking's own type label rather than deriving one", () => {
    const detail = toEventDetail({
      service: "caseworking",
      box: "outbox",
      doc: {
        ...anOutboxDoc(),
        _id: "665f1c2e9a1b2c3d4e5f6a7b",
        event: { id: "evt-1" },
        type: "audit",
        fullType: "Audit record — not a CloudEvent",
        target: "arn:aws:sns:eu-west-2:000000000000:cw__sns__audit_topic_arn",
      },
      maxAttempts: 7,
    });

    expect(detail.type).toBe("audit");
    expect(detail.typeTitle).toBe("Audit record — not a CloudEvent");
  });

  // And a GAS row keeps deriving its own, because for GAS rows this service
  // IS the authority.
  it("still derives a label for this service's own rows", () => {
    const detail = toEventDetail({
      service: "gas",
      box: "outbox",
      doc: {
        ...anOutboxDoc(),
        _id: "665f1c2e9a1b2c3d4e5f6a7b",
        event: { id: "evt-1" },
        target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn",
      },
      maxAttempts: 5,
    });

    expect(detail.type).toBe("audit");
  });
});

describe("toEventDetail attemptHistory", () => {
  const detailFor = (doc) =>
    toEventDetail({ service: "gas", box: "inbox", doc, maxAttempts: 5 });

  const anEntry = (message) => ({
    at: "2026-06-16T10:05:00.000Z",
    name: "TypeError",
    message,
    stack: null,
  });

  it("is [] on a row written before attempt history existed", () => {
    expect(detailFor(anInboxDoc()).attemptHistory).toEqual([]);
  });

  it("returns the stored history oldest first", () => {
    const attemptHistory = [anEntry("one"), anEntry("two")];

    expect(detailFor(anInboxDoc({ attemptHistory })).attemptHistory).toEqual(
      attemptHistory,
    );
  });

  it("maps a Caseworking document's history the same way", () => {
    const attemptHistory = [anEntry("cw")];
    const detail = toEventDetail({
      service: "caseworking",
      box: "inbox",
      doc: anInboxDoc({ attemptHistory }),
      maxAttempts: 7,
    });

    expect(detail.attemptHistory).toEqual(attemptHistory);
  });

  // The stack is served here now, but still as a declared key built one by
  // one - a stored key nobody declared is still dropped.
  it("rebuilds each entry from the four contract keys only", () => {
    const attemptHistory = [
      {
        ...anEntry("one"),
        stack: "Error: boom\n    at handler (x.js:1:1)",
        claimedBy: "SECRET-CLAIM-TOKEN",
      },
    ];

    const [entry] = detailFor(anInboxDoc({ attemptHistory })).attemptHistory;

    expect(Object.keys(entry)).toEqual(["at", "name", "message", "stack"]);
    expect(entry.stack).toBe("Error: boom\n    at handler (x.js:1:1)");
    expect(JSON.stringify(entry)).not.toContain("SECRET-CLAIM-TOKEN");
  });

  // Rows written before stacks were recorded, and claim-expiry sweeps: the
  // page draws no expander for these.
  it("serves a null stack where the entry has none", () => {
    const attemptHistory = [{ at: null, name: "ClaimExpired", message: "x" }];

    const [entry] = detailFor(anInboxDoc({ attemptHistory })).attemptHistory;

    expect(entry.stack).toBeNull();
  });

  it("tolerates a malformed stored history", () => {
    expect(
      detailFor(anInboxDoc({ attemptHistory: "nope" })).attemptHistory,
    ).toEqual([]);
    expect(
      detailFor(anInboxDoc({ attemptHistory: [{}] })).attemptHistory,
    ).toEqual([{ at: null, name: "Error", message: "", stack: null }]);
  });

  it("caps a stored history past ten entries", () => {
    const attemptHistory = Array.from({ length: 13 }, (_, i) =>
      anEntry(`${i}`),
    );

    const history = detailFor(anInboxDoc({ attemptHistory })).attemptHistory;

    expect(history).toHaveLength(10);
    expect(history.at(0).message).toBe("3");
  });

  it("is on the outbox detail too", () => {
    const attemptHistory = [anEntry("one")];

    expect(
      toEventDetail({
        service: "gas",
        box: "outbox",
        doc: anOutboxDoc({ attemptHistory }),
        maxAttempts: 5,
      }).attemptHistory,
    ).toEqual(attemptHistory);
  });
});

describe("toEventDetail typeTitle", () => {
  it("is the whole namespaced type behind a shortened one", () => {
    expect(inboxDetail().typeTitle).toBe(
      "cloud.defra.local.fg-cw-backend.case.status.updated",
    );
  });

  it("is null where a legacy type is kept whole", () => {
    const detail = outboxDetail({
      event: { id: "evt-2", type: "io.onsite.agreement.status.updated" },
    });

    expect(detail.type).toBe("io.onsite.agreement.status.updated");
    expect(detail.typeTitle).toBeNull();
  });

  // A type that is nothing but a namespace shortens to nothing, so the mapper
  // falls back to the stored value - and the two then agree.
  it("is null where the type shortens to nothing", () => {
    const detail = outboxDetail({
      event: { id: "evt-2", type: "cloud.defra.local.fg-gas-backend." },
    });

    expect(detail.type).toBe("cloud.defra.local.fg-gas-backend.");
    expect(detail.typeTitle).toBeNull();
  });

  it("explains the unknown label on an outbox row addressed at no audit topic", () => {
    const detail = outboxDetail({ event: { id: "evt-2" } });

    expect(detail.type).toBe("unknown");
    expect(detail.typeTitle).toBe("No event type recorded — not a CloudEvent");
  });

  it("explains the unknown label on an inbox row, which can never be audit", () => {
    const detail = inboxDetail({ type: null });

    expect(detail.type).toBe("unknown");
    expect(detail.typeTitle).toBe("No event type recorded — not a CloudEvent");
  });
});

describe("toEventDetail traceId", () => {
  it("extracts the 32-hex trace-id half of a W3C traceparent", () => {
    expect(inboxDetail().traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("accepts an upper-case W3C traceparent", () => {
    expect(
      inboxDetail({
        traceparent: "00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01",
      }).traceId,
    ).toBe("4BF92F3577B34DA6A3CE929D0E0E4736");
  });

  // Anything that is not a traceparent is already the value OpenSearch
  // indexes, so it is passed through untouched.
  it("passes a bare CDP request id through", () => {
    expect(inboxDetail({ traceparent: "1a2b3c4d5e6f" }).traceId).toBe(
      "1a2b3c4d5e6f",
    );
  });

  it("passes a traceparent whose trace-id is the wrong length through unchanged", () => {
    expect(inboxDetail({ traceparent: "00-deadbeef-0011-01" }).traceId).toBe(
      "00-deadbeef-0011-01",
    );
  });

  it.each([undefined, null, ""])(
    "is null for a %o traceparent",
    (traceparent) => {
      expect(inboxDetail({ traceparent }).traceId).toBeNull();
    },
  );
});
