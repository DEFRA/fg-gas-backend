import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toEventDetail } from "./map-event-detail.js";

const RETENTION_DAYS = 90;

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
    retentionDays: RETENTION_DAYS,
  });

const outboxDetail = (overrides) =>
  toEventDetail({
    service: "gas",
    box: "outbox",
    doc: anOutboxDoc(overrides),
    maxAttempts: 5,
    retentionDays: RETENTION_DAYS,
  });

// `lastError` stores a stack; this transform stands between it and the wire.
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

// `expireAt` in the store, "Deletion date" in the admin - hence the rename.
describe("toEventDetail expiresAt", () => {
  it("is null on a row with no deadline - every dead letter has none", () => {
    expect(inboxDetail().expiresAt).toBeNull();
    expect(outboxDetail().expiresAt).toBeNull();
  });

  it("is null on a row written before the field existed", () => {
    expect(inboxDetail({ expireAt: undefined }).expiresAt).toBeNull();
  });

  it("serialises a stored Date as an instant", () => {
    const expireAt = new Date("2026-12-16T10:00:00.000Z");

    expect(inboxDetail({ expireAt }).expiresAt).toBe(
      "2026-12-16T10:00:00.000Z",
    );
    expect(outboxDetail({ expireAt }).expiresAt).toBe(
      "2026-12-16T10:00:00.000Z",
    );
  });

  // Caseworking serialises its own top-level Dates, so GAS receives a string.
  it("passes a Caseworking row's deadline through", () => {
    const detail = toEventDetail({
      service: "caseworking",
      box: "inbox",
      doc: {
        ...anInboxDoc(),
        _id: "665f1c2e9a1b2c3d4e5f6a7b",
        expireAt: "2026-12-16T10:00:00.000Z",
      },
      maxAttempts: 7,
    });

    expect(detail.expiresAt).toBe("2026-12-16T10:00:00.000Z");
  });
});

describe("toEventDetail lastRedrive", () => {
  it("names an unattributed redrive as the platform's own", () => {
    const doc = anInboxDoc({
      lastRedrive: { at: "2026-06-16T11:05:00.000Z", by: null },
    });

    expect(
      toEventDetail({ service: "gas", box: "inbox", doc, maxAttempts: 5 })
        .lastRedrive,
    ).toEqual({ at: "2026-06-16T11:05:00.000Z", by: "System" });
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
  it("carries every field a single-row answer has", () => {
    const detail = inboxDetail();

    expect(detail).toMatchObject({
      service: "gas",
      box: "inbox",
      id: "665f1c2e9a1b2c3d4e5f6a7b",
      eventId: "msg-1",
      type: "case.status.updated",
      targetTopic: null,
      segregationRef: "GLD-9B2",
      status: "DEAD_LETTER",
      statusLabel: "Dead letter",
      statusRole: "error",
      statusRetrying: false,
      attempts: "5/5",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      createdAt: "2026-06-16T10:00:01.000Z",
    });
  });

  it("dates the row by its publicationDate, as the list does", () => {
    expect(inboxDetail().createdAt).toBe(anInboxDoc().publicationDate);
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

  it("sends the trace-id half of the traceparent", () => {
    expect(inboxDetail().traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("adds the lifecycle dates", () => {
    const detail = inboxDetail();

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
  it("keeps the topic name on `targetTopic` and sends no raw ARN", () => {
    const detail = outboxDetail();

    expect(detail.targetTopic).toBe("gas__sns__create_new_case_fifo.fifo");
    expect(detail).not.toHaveProperty("targetRaw");
  });

  it("adds the full event payload verbatim", () => {
    expect(outboxDetail().payload.data).toEqual({ clientRef: "REF-2" });
  });

  it("carries the segregationRef the document stores", () => {
    expect(outboxDetail().segregationRef).toBe("GLD-9B2");
  });

  it("carries a null segregationRef for an older row that stored none", () => {
    expect(
      outboxDetail({ segregationRef: undefined }).segregationRef,
    ).toBeNull();
  });

  it("carries a Caseworking outbox document's segregationRef", () => {
    const detail = toEventDetail({
      service: "caseworking",
      box: "outbox",
      doc: { ...anOutboxDoc(), _id: "665f1c2e9a1b2c3d4e5f6a7b" },
      maxAttempts: 7,
    });

    expect(detail.segregationRef).toBe("GLD-9B2");
  });

  it("dates the row by a Date publicationDate, as an ISO string", () => {
    expect(outboxDetail().createdAt).toBe("2026-06-16T10:00:00.000Z");
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
    expect(detail.payload.audit.entities[0].entityid).toBe("APP-1");
  });
});

describe("toEventDetail caseworking", () => {
  it("maps a caseworking inbox document with CW's own maxAttempts", () => {
    const detail = toEventDetail({
      service: "caseworking",
      box: "inbox",
      doc: { ...anInboxDoc(), _id: "665f1c2e9a1b2c3d4e5f6a7b" },
      maxAttempts: 7,
    });

    expect(detail.service).toBe("caseworking");
    expect(detail.id).toBe("665f1c2e9a1b2c3d4e5f6a7b");
    expect(detail.attempts).toBe("5/7");
    expect(detail.payload).toEqual(anInboxDoc().event);
  });

  // CW labels its own audit topic, which this service cannot recognise.
  it("takes Caseworking's own type label rather than deriving one", () => {
    const detail = toEventDetail({
      service: "caseworking",
      box: "outbox",
      doc: {
        ...anOutboxDoc(),
        _id: "665f1c2e9a1b2c3d4e5f6a7b",
        event: { id: "evt-1" },
        type: "audit",
        target: "arn:aws:sns:eu-west-2:000000000000:cw__sns__audit_topic_arn",
      },
      maxAttempts: 7,
    });

    expect(detail.type).toBe("audit");
  });

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

describe("toEventDetail outbox traceId", () => {
  it("extracts the trace-id half of a W3C event.traceparent", () => {
    expect(outboxDetail().traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("passes a non-W3C event.traceparent through", () => {
    expect(
      outboxDetail({
        event: { id: "evt-2", traceparent: "1a2b3c4d5e6f" },
      }).traceId,
    ).toBe("1a2b3c4d5e6f");
  });

  it("is null when the event carries no traceparent", () => {
    expect(outboxDetail({ event: { id: "evt-2" } }).traceId).toBeNull();
  });

  it("is null when there is no event at all", () => {
    expect(outboxDetail({ event: undefined }).traceId).toBeNull();
  });

  it("ignores a top-level traceparent on an outbox document", () => {
    expect(
      outboxDetail({
        traceparent: TRACEPARENT,
        event: { id: "evt-2" },
      }).traceId,
    ).toBeNull();
  });

  it("is null on an audit row", () => {
    expect(
      outboxDetail({
        target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn",
        event: { correlationid: "corr-1", audit: { entities: [] } },
      }).traceId,
    ).toBeNull();
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

describe("toEventDetail lastPurge", () => {
  const aPurge = (overrides = {}) => ({
    at: "2026-09-21T09:00:00.000Z",
    by: "donatas",
    reasonCode: "BROKEN_PAYLOAD",
    note: "the payload lost its clientRef",
    ...overrides,
  });

  it("is null on a row nobody has purged", () => {
    expect(inboxDetail().lastPurge).toBeNull();
    expect(outboxDetail().lastPurge).toBeNull();
  });

  it("is null on a row written before the field existed", () => {
    expect(inboxDetail({ lastPurge: undefined }).lastPurge).toBeNull();
  });

  it("maps the record key by key", () => {
    expect(inboxDetail({ lastPurge: aPurge() }).lastPurge).toEqual({
      at: "2026-09-21T09:00:00.000Z",
      by: "donatas",
      reasonCode: "BROKEN_PAYLOAD",
      note: "the payload lost its clientRef",
    });
  });

  it("drops a key another version added rather than passing it on", () => {
    const detail = inboxDetail({
      lastPurge: aPurge({ approvedBy: "SOMEONE-ELSE" }),
    });

    expect(Object.keys(detail.lastPurge)).toEqual([
      "at",
      "by",
      "reasonCode",
      "note",
    ]);
    expect(JSON.stringify(detail)).not.toContain("SOMEONE-ELSE");
  });

  it("names an unattributed purge as the platform's own", () => {
    const doc = anInboxDoc({ lastPurge: aPurge({ by: null }) });

    expect(
      toEventDetail({
        service: "gas",
        box: "inbox",
        doc,
        maxAttempts: 5,
        retentionDays: RETENTION_DAYS,
      }).lastPurge.by,
    ).toBe("System");
    expect(doc.lastPurge.by).toBeNull();
  });

  it("keeps a missing note null rather than inventing one", () => {
    expect(
      inboxDetail({ lastPurge: aPurge({ note: null }) }).lastPurge.note,
    ).toBeNull();
    expect(
      inboxDetail({ lastPurge: aPurge({ note: undefined }) }).lastPurge.note,
    ).toBeNull();
  });

  it("survives a record with no reason code at all", () => {
    expect(
      inboxDetail({ lastPurge: aPurge({ reasonCode: undefined }) }).lastPurge
        .reasonCode,
    ).toBe("");
  });

  it("stays on a row that has since been redriven", () => {
    const detail = inboxDetail({
      status: "RESUBMITTED",
      lastPurge: aPurge(),
      lastRedrive: { at: "2026-09-22T09:00:00.000Z", by: "donatas" },
    });

    expect(detail.status).toBe("RESUBMITTED");
    expect(detail.lastPurge).not.toBeNull();
  });

  it("passes a Caseworking record through the same mapping", () => {
    const detail = toEventDetail({
      service: "caseworking",
      box: "inbox",
      doc: {
        ...anInboxDoc(),
        _id: "665f1c2e9a1b2c3d4e5f6a7b",
        lastPurge: aPurge({ by: null }),
      },
      maxAttempts: 7,
      retentionDays: RETENTION_DAYS,
    });

    expect(detail.lastPurge).toEqual({
      at: "2026-09-21T09:00:00.000Z",
      by: "System",
      reasonCode: "BROKEN_PAYLOAD",
      note: "the payload lost its clientRef",
    });
  });
});

describe("toEventDetail purgeDeletionDate", () => {
  const NOW = new Date("2026-09-21T09:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("projects now + the retention on a GAS dead letter", () => {
    expect(inboxDetail().purgeDeletionDate).toBe("2026-12-20T09:00:00.000Z");
    expect(outboxDetail().purgeDeletionDate).toBe("2026-12-20T09:00:00.000Z");
  });

  it("follows a shorter configured retention", () => {
    const detail = toEventDetail({
      service: "gas",
      box: "inbox",
      doc: anInboxDoc(),
      maxAttempts: 5,
      retentionDays: 30,
    });

    expect(detail.purgeDeletionDate).toBe("2026-10-21T09:00:00.000Z");
  });

  it.each(["COMPLETED", "PURGED", "PUBLISHED", "PROCESSING", "FAILED"])(
    "is null on a %s row, which cannot be purged",
    (status) => {
      expect(inboxDetail({ status }).purgeDeletionDate).toBeNull();
      expect(outboxDetail({ status }).purgeDeletionDate).toBeNull();
    },
  );

  // The two services may be configured with different retentions.
  it("passes a Caseworking projection through untouched", () => {
    const detail = toEventDetail({
      service: "caseworking",
      box: "inbox",
      doc: {
        ...anInboxDoc(),
        _id: "665f1c2e9a1b2c3d4e5f6a7b",
        purgeDeletionDate: "2027-01-01T00:00:00.000Z",
      },
      maxAttempts: 7,
      retentionDays: RETENTION_DAYS,
    });

    expect(detail.purgeDeletionDate).toBe("2027-01-01T00:00:00.000Z");
  });

  it("is null for a Caseworking row that names no projection", () => {
    const detail = toEventDetail({
      service: "caseworking",
      box: "inbox",
      doc: { ...anInboxDoc(), _id: "665f1c2e9a1b2c3d4e5f6a7b" },
      maxAttempts: 7,
      retentionDays: RETENTION_DAYS,
    });

    expect(detail.purgeDeletionDate).toBeNull();
  });
});
