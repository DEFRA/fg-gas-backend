import { describe, expect, it } from "vitest";
import {
  eventDetailResponseSchema,
  redriveEventResponseSchema,
} from "./event-detail-response.schema.js";
import { eventRowSchema } from "./find-events-response.schema.js";

const aRow = (overrides = {}) => ({
  service: "gas",
  box: "outbox",
  id: "665f1c2e9a1b2c3d4e5f6a7b",
  eventId: "evt-1",
  type: "case.create",
  fullType: "cloud.defra.local.fg-gas-backend.case.create",
  source: null,
  target: "gas__sns__create_new_case_fifo.fifo",
  segregationRef: "GLD-9B2",
  status: "DEAD_LETTER",
  attempts: 5,
  maxAttempts: 5,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  createdAt: "2026-06-16T10:00:00.000Z",
  lastFailureAt: null,
  lastError: null,
  completedAt: null,
  parked: null,
  ...overrides,
});

const aDetail = (overrides = {}) => ({
  ...aRow(),
  payload: { id: "evt-1", data: { clientRef: "REF-1" } },
  targetRaw:
    "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case_fifo.fifo",
  messageId: null,
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  publicationDate: "2026-06-16T10:00:00.000Z",
  completionDate: null,
  lastResubmissionDate: null,
  claimedAt: null,
  claimExpiresAt: null,
  attemptHistory: [],
  lastRedrive: null,
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

  it("rejects a detail that is only a list row", () => {
    expect(eventDetailResponseSchema.validate(aRow()).error).toBeDefined();
  });

  it("requires every detail-only field", () => {
    for (const key of [
      "targetRaw",
      "messageId",
      "traceparent",
      "publicationDate",
      "completionDate",
      "lastResubmissionDate",
      "claimedAt",
      "claimExpiresAt",
    ]) {
      const { [key]: _dropped, ...without } = aDetail();

      expect(eventDetailResponseSchema.validate(without).error).toBeDefined();
    }
  });
});

describe("redriveEventResponseSchema", () => {
  it("is labelled RedriveEventResponse", () => {
    expect(redriveEventResponseSchema.describe().flags.label).toBe(
      "RedriveEventResponse",
    );
  });

  it("accepts one list row under `event`", () => {
    expect(
      redriveEventResponseSchema.validate({ event: aRow() }).error,
    ).toBeUndefined();
  });

  it("requires the event key", () => {
    expect(redriveEventResponseSchema.validate({}).error).toBeDefined();
  });

  it("rejects a payload on the redrive row - a redrive returns a list row", () => {
    expect(
      redriveEventResponseSchema.validate({ event: aDetail() }).error,
    ).toBeDefined();
  });
});

describe("eventDetailResponseSchema attemptHistory", () => {
  const anEntry = {
    at: "2026-06-16T10:05:00.000Z",
    name: "ClaimExpired",
    message: "claim expired before completion",
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

  it("is not on a list row - the list carries lastError alone", () => {
    expect(
      eventRowSchema.validate({ ...aRow(), attemptHistory: [] }).error,
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

  it("accepts an unattributed redrive", () => {
    const { error } = eventDetailResponseSchema.validate(
      aDetail({ lastRedrive: { at: "2026-06-16T11:05:00.000Z", by: null } }),
    );

    expect(error).toBeUndefined();
  });

  it("requires the key, so a mapping gap fails a test", () => {
    const { lastRedrive, ...detail } = aDetail();

    expect(eventDetailResponseSchema.validate(detail).error).toBeDefined();
  });

  it("is detail only - a list row carries `parked` but never `lastRedrive`", () => {
    expect(
      Object.keys(eventRowSchema.describe().keys).includes("lastRedrive"),
    ).toBe(false);
    expect(Object.keys(eventRowSchema.describe().keys)).toContain("parked");
  });
});
