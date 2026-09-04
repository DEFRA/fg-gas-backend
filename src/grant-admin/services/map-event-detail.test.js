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

describe("toEventDetail inbox", () => {
  it("carries every list row field", () => {
    const detail = inboxDetail();

    expect(detail).toMatchObject({
      service: "gas",
      box: "inbox",
      id: "665f1c2e9a1b2c3d4e5f6a7b",
      eventId: "msg-1",
      type: "case.status.updated",
      fullType: "cloud.defra.local.fg-cw-backend.case.status.updated",
      source: "CW",
      segregationRef: "GLD-9B2",
      status: "DEAD_LETTER",
      attempts: 5,
      maxAttempts: 5,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      createdAt: "2026-06-16T10:00:00.000Z",
      lastFailureAt: "2026-06-16T10:05:00.000Z",
      completedAt: null,
    });
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

  it("adds messageId", () => {
    expect(inboxDetail().messageId).toBe("msg-1");
  });

  it("has a null targetRaw - an inbox row has no target", () => {
    expect(inboxDetail().targetRaw).toBeNull();
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
  it("keeps the topic name on `target` and the full ARN on `targetRaw`", () => {
    const detail = outboxDetail();

    expect(detail.target).toBe("gas__sns__create_new_case_fifo.fifo");
    expect(detail.targetRaw).toBe(
      "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case_fifo.fifo",
    );
  });

  it("adds the full event payload verbatim", () => {
    expect(outboxDetail().payload.data).toEqual({ clientRef: "REF-2" });
  });

  it("reads the traceparent out of the payload", () => {
    expect(outboxDetail().traceparent).toBe(TRACEPARENT);
  });

  it("renders Date claim fields as ISO strings", () => {
    const detail = outboxDetail();

    expect(detail.claimedAt).toBe("2026-06-16T10:04:00.000Z");
    expect(detail.claimExpiresAt).toBe("2026-06-16T10:09:00.000Z");
  });

  it("renders a Date publicationDate as an ISO string", () => {
    expect(outboxDetail().publicationDate).toBe("2026-06-16T10:00:00.000Z");
  });

  it("has a null messageId - an outbox row has none", () => {
    expect(outboxDetail().messageId).toBeNull();
  });

  it("maps an audit row through the same derivation as every other row", () => {
    const detail = outboxDetail({
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

    // An audit record is not a CloudEvent, so it has no type to state.
    expect(detail.type).toBeNull();
    expect(detail.fullType).toBeNull();
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
    expect(detail.maxAttempts).toBe(7);
    expect(detail.payload).toEqual(anInboxDoc().event);
  });
});

describe("toEventDetail attemptHistory", () => {
  const detailFor = (doc) =>
    toEventDetail({ service: "gas", box: "inbox", doc, maxAttempts: 5 });

  const anEntry = (message) => ({
    at: "2026-06-16T10:05:00.000Z",
    name: "TypeError",
    message,
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

  it("rebuilds each entry from the three contract keys only", () => {
    const attemptHistory = [{ ...anEntry("one"), stack: "SECRET-STACK" }];

    const [entry] = detailFor(anInboxDoc({ attemptHistory })).attemptHistory;

    expect(Object.keys(entry)).toEqual(["at", "name", "message"]);
  });

  it("tolerates a malformed stored history", () => {
    expect(
      detailFor(anInboxDoc({ attemptHistory: "nope" })).attemptHistory,
    ).toEqual([]);
    expect(
      detailFor(anInboxDoc({ attemptHistory: [{}] })).attemptHistory,
    ).toEqual([{ at: null, name: "Error", message: "" }]);
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
