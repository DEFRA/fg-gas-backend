import { describe, expect, it } from "vitest";
import { eventDetailResponseSchema } from "./event-detail-response.schema.js";
import { eventRowSchema } from "./events-shared.schema.js";

const aRow = (overrides = {}) => ({
  service: "gas",
  box: "outbox",
  id: "665f1c2e9a1b2c3d4e5f6a7b",
  eventId: "evt-1",
  type: "case.create",
  status: "DEAD_LETTER",
  statusLabel: "Dead letter",
  statusRole: "error",
  statusRetrying: false,
  createdAt: "2026-06-16T10:00:00.000Z",
  ...overrides,
});

const aSingleRow = (overrides = {}) => ({
  ...aRow(),
  attempts: "5/5",
  targetTopic: "gas__sns__create_new_case_fifo.fifo",
  lastError: null,
  ...overrides,
});

const aListRow = (overrides = {}) => ({
  ...aRow(),
  latency: null,
  latencyTitle: "Queued to delivered to SNS",
  ...overrides,
});

const aDetail = (overrides = {}) => ({
  ...aSingleRow(),
  payload: { id: "evt-1", data: { clientRef: "REF-1" } },
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  completionDate: null,
  expiresAt: null,
  lastResubmissionDate: null,
  attemptHistory: [],
  lastRedrive: null,
  lastPurge: null,
  purgeDeletionDate: null,
  segregationRef: "GLD-9B2",
  ...overrides,
});

const anInboxDetail = (overrides = {}) =>
  aDetail({
    box: "inbox",
    targetTopic: null,
    ...overrides,
  });

describe("eventDetailResponseSchema", () => {
  it("is labelled EventDetail", () => {
    expect(eventDetailResponseSchema.describe().flags.label).toBe(
      "EventDetail",
    );
  });

  it("accepts a whole detail object", () => {
    expect(eventDetailResponseSchema.validate(aDetail()).error).toBeUndefined();
  });

  it("accepts an arbitrary payload shape", () => {
    const payload = { anything: { at: "all" }, list: [1, 2, 3] };

    expect(
      eventDetailResponseSchema.validate(aDetail({ payload })).error,
    ).toBeUndefined();
  });

  it("keeps the payload's unknown keys rather than stripping them", () => {
    const payload = { audit: { entities: [{ entityid: "APP-1" }] } };
    const { value } = eventDetailResponseSchema.validate(aDetail({ payload }));

    expect(value.payload).toEqual(payload);
  });

  it("requires the payload key", () => {
    const { payload, ...without } = aDetail();

    expect(eventDetailResponseSchema.validate(without).error).toBeDefined();
  });

  it("allows a null payload", () => {
    expect(
      eventDetailResponseSchema.validate(aDetail({ payload: null })).error,
    ).toBeUndefined();
  });

  it("forbids claimedBy, so a claim token can never be returned", () => {
    const { error } = eventDetailResponseSchema.validate(
      aDetail({ claimedBy: "claim-token" }),
    );

    expect(error).toBeDefined();
    expect(error.message).toContain("claimedBy");
  });

  it("rejects a row that is only a row", () => {
    expect(eventDetailResponseSchema.validate(aRow()).error).toBeDefined();
    expect(
      eventDetailResponseSchema.validate(aSingleRow()).error,
    ).toBeDefined();
  });

  it("requires every detail-only field", () => {
    for (const key of [
      "traceId",
      "completionDate",
      "expiresAt",
      "lastResubmissionDate",
    ]) {
      const { [key]: _dropped, ...without } = aDetail();

      expect(eventDetailResponseSchema.validate(without).error).toBeDefined();
    }
  });

  it("rejects a detail carrying the list's latency", () => {
    expect(
      eventDetailResponseSchema.validate(aDetail({ latency: "1.2s" })).error,
    ).toBeDefined();
  });
});

describe("eventDetailResponseSchema type", () => {
  it("accepts the audit and unknown labels", () => {
    for (const type of ["audit", "unknown"]) {
      expect(
        eventDetailResponseSchema.validate(aDetail({ type })).error,
      ).toBeUndefined();
    }
  });
});

describe("eventDetailResponseSchema segregationRef", () => {
  it.each([
    ["an inbox", anInboxDetail],
    ["an outbox", aDetail],
  ])("accepts %s detail carrying one, or null", (_name, detail) => {
    expect(eventDetailResponseSchema.validate(detail()).error).toBeUndefined();
    expect(
      eventDetailResponseSchema.validate(detail({ segregationRef: null }))
        .error,
    ).toBeUndefined();
  });

  it("requires the key on every detail", () => {
    const { segregationRef: _dropped, ...without } = aDetail();

    expect(eventDetailResponseSchema.validate(without).error).toBeDefined();
  });
});

describe("eventDetailResponseSchema trace id", () => {
  it.each([
    ["an inbox", anInboxDetail],
    ["an outbox", aDetail],
  ])("accepts a null traceId on %s detail", (_name, detail) => {
    expect(
      eventDetailResponseSchema.validate(detail({ traceId: null })).error,
    ).toBeUndefined();
  });

  it("accepts a bare CDP request id as traceId", () => {
    expect(
      eventDetailResponseSchema.validate(
        anInboxDetail({ traceId: "cdp-request-1" }),
      ).error,
    ).toBeUndefined();
  });

  it("rejects a non-string traceId", () => {
    expect(
      eventDetailResponseSchema.validate(anInboxDetail({ traceId: 42 })).error,
    ).toBeDefined();
  });
});

describe("eventDetailResponseSchema attemptHistory", () => {
  const anEntry = {
    at: "2026-06-16T10:05:00.000Z",
    name: "ClaimExpired",
    message: "claim expired before completion",
    stack: null,
  };

  it("accepts an empty history", () => {
    expect(
      eventDetailResponseSchema.validate(aDetail({ attemptHistory: [] })).error,
    ).toBeUndefined();
  });

  it("accepts a history of entries, including a null at", () => {
    expect(
      eventDetailResponseSchema.validate(
        aDetail({ attemptHistory: [anEntry, { ...anEntry, at: null }] }),
      ).error,
    ).toBeUndefined();
  });

  it("requires the key, so a mapping gap fails a test rather than a render", () => {
    const { attemptHistory, ...without } = aDetail();

    expect(eventDetailResponseSchema.validate(without).error).toBeDefined();
  });

  it("rejects null, a non-array and an entry with no name", () => {
    expect(
      eventDetailResponseSchema.validate(aDetail({ attemptHistory: null }))
        .error,
    ).toBeDefined();
    expect(
      eventDetailResponseSchema.validate(aDetail({ attemptHistory: {} })).error,
    ).toBeDefined();
    expect(
      eventDetailResponseSchema.validate(
        aDetail({ attemptHistory: [{ at: null, message: "x" }] }),
      ).error,
    ).toBeDefined();
  });

  it("allows an empty message, as lastError does", () => {
    expect(
      eventDetailResponseSchema.validate(
        aDetail({ attemptHistory: [{ ...anEntry, message: "" }] }),
      ).error,
    ).toBeUndefined();
  });

  it("serves the stack on an attempt", () => {
    expect(
      eventDetailResponseSchema.validate(
        aDetail({
          attemptHistory: [
            { ...anEntry, stack: "Error: boom\n    at handler (x.js:1:1)" },
          ],
        }),
      ).error,
    ).toBeUndefined();
  });

  it("requires the stack key, so a mapping gap fails a test", () => {
    const { stack, ...noStack } = anEntry;

    expect(
      eventDetailResponseSchema.validate(aDetail({ attemptHistory: [noStack] }))
        .error,
    ).toBeDefined();
  });

  it("is not on a list row", () => {
    expect(
      eventRowSchema.validate(aListRow({ attemptHistory: [] })).error,
    ).toBeDefined();
  });
});

// Response validation fails closed, so an unnamed key 500s the page.
describe("eventDetailResponseSchema expiresAt", () => {
  it("accepts a deletion date on a completed row", () => {
    const { error } = eventDetailResponseSchema.validate(
      aDetail({
        status: "COMPLETED",
        statusLabel: "Completed",
        statusRole: "success",
        expiresAt: "2026-12-16T10:00:00.000Z",
      }),
    );

    expect(error).toBeUndefined();
  });

  it("accepts null, the value every dead-lettered and in-flight row has", () => {
    expect(
      eventDetailResponseSchema.validate(aDetail({ expiresAt: null })).error,
    ).toBeUndefined();
  });

  it("requires the key, so a mapping gap fails a test rather than a render", () => {
    const { expiresAt: _dropped, ...without } = aDetail();

    expect(eventDetailResponseSchema.validate(without).error).toBeDefined();
  });

  it("rejects a value that is not an instant", () => {
    expect(
      eventDetailResponseSchema.validate(aDetail({ expiresAt: "soon" })).error,
    ).toBeDefined();
  });
});

describe("eventDetailResponseSchema lastRedrive", () => {
  it("accepts a redrive record with its actor", () => {
    const { error } = eventDetailResponseSchema.validate(
      aDetail({
        lastRedrive: { at: "2026-06-16T11:05:00.000Z", by: "donatas" },
      }),
    );

    expect(error).toBeUndefined();
  });

  it("rejects a null actor, which the mapper never sends", () => {
    const { error } = eventDetailResponseSchema.validate(
      aDetail({ lastRedrive: { at: "2026-06-16T11:05:00.000Z", by: null } }),
    );

    expect(error).toBeDefined();
  });

  it("accepts the platform's own redrive", () => {
    const { error } = eventDetailResponseSchema.validate(
      aDetail({
        lastRedrive: { at: "2026-06-16T11:05:00.000Z", by: "System" },
      }),
    );

    expect(error).toBeUndefined();
  });

  it("requires the key, so a mapping gap fails a test", () => {
    const { lastRedrive, ...detail } = aDetail();

    expect(eventDetailResponseSchema.validate(detail).error).toBeDefined();
  });

  it("is detail only - a list row never carries `lastRedrive`", () => {
    expect(
      Object.keys(eventRowSchema.describe().keys).includes("lastRedrive"),
    ).toBe(false);
  });
});

describe("eventDetailResponseSchema as the whole answer", () => {
  it("is what the detail route publishes, closed against anything else", () => {
    expect(eventDetailResponseSchema.validate(aDetail()).error).toBeUndefined();
    expect(
      eventDetailResponseSchema.validate({ ...aDetail(), extra: 1 }).error,
    ).toBeDefined();
  });

  it("rejects a null detail field", () => {
    expect(
      eventDetailResponseSchema.validate(aDetail({ attemptHistory: null }))
        .error,
    ).toBeDefined();
  });
});

// Response validation fails closed: a key the schema does not know 500s the
// event page.
describe("eventDetailResponseSchema lastPurge", () => {
  const aPurge = (overrides = {}) => ({
    at: "2026-09-21T09:00:00.000Z",
    by: "donatas",
    reasonCode: "BROKEN_PAYLOAD",
    note: "the payload lost its clientRef",
    ...overrides,
  });

  it("accepts a purge record with its actor, reason and note", () => {
    expect(
      eventDetailResponseSchema.validate(aDetail({ lastPurge: aPurge() }))
        .error,
    ).toBeUndefined();
  });

  it("accepts a record with no note, which is every purge that gave none", () => {
    expect(
      eventDetailResponseSchema.validate(
        aDetail({ lastPurge: aPurge({ note: null }) }),
      ).error,
    ).toBeUndefined();
  });

  it("accepts null, the value every row nobody purged has", () => {
    expect(
      eventDetailResponseSchema.validate(aDetail({ lastPurge: null })).error,
    ).toBeUndefined();
  });

  it("requires the key, so a mapping gap fails a test rather than a render", () => {
    const { lastPurge: _dropped, ...without } = aDetail();

    expect(eventDetailResponseSchema.validate(without).error).toBeDefined();
  });

  // The label is the admin's business; an unknown code must not 500 the page.
  it("takes a reason code it does not recognise", () => {
    expect(
      eventDetailResponseSchema.validate(
        aDetail({ lastPurge: aPurge({ reasonCode: "SOMETHING_NEW" }) }),
      ).error,
    ).toBeUndefined();
  });

  it("requires every key of the record", () => {
    for (const key of ["at", "by", "reasonCode", "note"]) {
      const { [key]: _dropped, ...partial } = aPurge();

      expect(
        eventDetailResponseSchema.validate(aDetail({ lastPurge: partial }))
          .error,
      ).toBeDefined();
    }
  });

  it("rejects an `at` that is not an instant", () => {
    expect(
      eventDetailResponseSchema.validate(
        aDetail({ lastPurge: aPurge({ at: "yesterday" }) }),
      ).error,
    ).toBeDefined();
  });
});

describe("eventDetailResponseSchema purgeDeletionDate", () => {
  it("accepts a projection on a dead-lettered row", () => {
    expect(
      eventDetailResponseSchema.validate(
        aDetail({ purgeDeletionDate: "2026-12-20T09:00:00.000Z" }),
      ).error,
    ).toBeUndefined();
  });

  it("accepts null, the value every row that cannot be purged has", () => {
    expect(
      eventDetailResponseSchema.validate(aDetail({ purgeDeletionDate: null }))
        .error,
    ).toBeUndefined();
  });

  it("requires the key, so a mapping gap fails a test rather than a render", () => {
    const { purgeDeletionDate: _dropped, ...without } = aDetail();

    expect(eventDetailResponseSchema.validate(without).error).toBeDefined();
  });

  it("rejects a value that is not an instant", () => {
    expect(
      eventDetailResponseSchema.validate(
        aDetail({ purgeDeletionDate: "in 90 days" }),
      ).error,
    ).toBeDefined();
  });
});
