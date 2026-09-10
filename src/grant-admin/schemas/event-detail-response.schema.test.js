import { describe, expect, it } from "vitest";
import {
  eventDetailPageResponseSchema,
  eventDetailResponseSchema,
  redriveEventResponseSchema,
} from "./event-detail-response.schema.js";
import {
  eventRowSchema,
  journeyHopSchema,
} from "./find-events-response.schema.js";

// The row every row-shaped response shares - the detail and the redrive
// answer with this, and the list adds its own duration column to it.
const aRow = (overrides = {}) => ({
  service: "gas",
  box: "outbox",
  id: "665f1c2e9a1b2c3d4e5f6a7b",
  eventId: "evt-1",
  type: "case.create",
  hop: "GAS Outbox",
  queue: "to Caseworking",
  queueValue: "gas__sns__create_new_case_fifo.fifo",
  status: "DEAD_LETTER",
  statusLabel: "Dead letter",
  statusRole: "error",
  statusRetrying: false,
  attempts: "5/5",
  showAttempts: true,
  createdAt: "2026-06-16T10:00:00.000Z",
  lastFailureAt: null,
  lastError: null,
  ...overrides,
});

const aListRow = (overrides = {}) => ({
  ...aRow(),
  latency: null,
  latencyTitle: "Queued to delivered to SNS",
  ...overrides,
});

// An OUTBOX detail, which is why it carries no reference, traceparent or
// trace id: this service published the message, so it has none of the three.
const aDetail = (overrides = {}) => ({
  ...aRow(),
  payload: { id: "evt-1", data: { clientRef: "REF-1" } },
  typeTitle: "cloud.defra.local.fg-gas-backend.case.create",
  occurredAt: "2026-06-16T10:00:00.000Z",
  messageGroupId: "GLD-9B2",
  publicationDate: "2026-06-16T10:00:00.000Z",
  completionDate: null,
  lastResubmissionDate: null,
  claimedAt: null,
  claimExpiresAt: null,
  attemptHistory: [],
  lastRedrive: null,
  ...overrides,
});

const anInboxDetail = (overrides = {}) =>
  aDetail({
    box: "inbox",
    hop: "GAS Inbox",
    queue: "from Caseworking",
    queueValue: null,
    segregationRef: "GLD-9B2",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
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
      "typeTitle",
      "occurredAt",
      "messageGroupId",
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

  // The list's own duration column: the detail page has no room for it.
  it("rejects a detail carrying the list's latency", () => {
    expect(
      eventDetailResponseSchema.validate(aDetail({ latency: "1.2s" })).error,
    ).toBeDefined();
  });
});

// Null typeTitle is a fact rather than a gap - it means the two forms agree
// - so the KEY is required and a missing one still fails a test.
describe("eventDetailResponseSchema typeTitle", () => {
  it("accepts a null typeTitle, which says the long form adds nothing", () => {
    expect(
      eventDetailResponseSchema.validate(aDetail({ typeTitle: null })).error,
    ).toBeUndefined();
  });

  it("accepts the sentence behind the audit label", () => {
    expect(
      eventDetailResponseSchema.validate(
        aDetail({
          type: "audit",
          typeTitle: "Audit record — not a CloudEvent",
        }),
      ).error,
    ).toBeUndefined();
  });

  it("accepts the sentence behind the unknown label", () => {
    expect(
      eventDetailResponseSchema.validate(
        aDetail({
          type: "unknown",
          typeTitle: "No event type recorded — not a CloudEvent",
        }),
      ).error,
    ).toBeUndefined();
  });
});

describe("eventDetailResponseSchema inbox-only fields", () => {
  it("accepts an inbox detail carrying all three", () => {
    expect(
      eventDetailResponseSchema.validate(anInboxDetail()).error,
    ).toBeUndefined();
  });

  it("accepts an outbox detail carrying none of them", () => {
    for (const key of ["segregationRef", "traceparent", "traceId"]) {
      expect(aDetail()).not.toHaveProperty(key);
    }

    expect(eventDetailResponseSchema.validate(aDetail()).error).toBeUndefined();
  });

  // An audit record carries no traceparent at all, so the frontend renders no
  // link rather than a broken one.
  it("accepts a null traceId and traceparent", () => {
    expect(
      eventDetailResponseSchema.validate(
        anInboxDetail({ traceparent: null, traceId: null }),
      ).error,
    ).toBeUndefined();
  });

  // A bare CDP request id is already the value OpenSearch indexes.
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

describe("redriveEventResponseSchema", () => {
  it("is labelled RedriveEventResponse", () => {
    expect(redriveEventResponseSchema.describe().flags.label).toBe(
      "RedriveEventResponse",
    );
  });

  it("accepts one row under `event`", () => {
    expect(
      redriveEventResponseSchema.validate({ event: aRow() }).error,
    ).toBeUndefined();
  });

  it("rejects the list's latency on the redrive row", () => {
    expect(
      redriveEventResponseSchema.validate({ event: aListRow() }).error,
    ).toBeDefined();
  });

  it("requires the event key", () => {
    expect(redriveEventResponseSchema.validate({}).error).toBeDefined();
  });

  it("rejects a payload on the redrive row - a redrive returns a row", () => {
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
    // Null here on purpose: the claim-expiry sweep has no exception, so this
    // is the shape of an attempt the page draws no expander for.
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

  // The stack the attempts section expands to reveal. Served deliberately, so
  // it is a declared key: present and null where there is nothing to reveal.
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

  it("is not on a list row - the list carries lastError alone", () => {
    expect(
      eventRowSchema.validate(aListRow({ attemptHistory: [] })).error,
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

  // The mapper names an unattributed redrive `System` before it gets here, so
  // a null actor on the wire is a mapping gap rather than a system redrive.
  it("rejects a null actor, which the mapper never sends", () => {
    const { error } = eventDetailResponseSchema.validate(
      aDetail({ lastRedrive: { at: "2026-06-16T11:05:00.000Z", by: null } }),
    );

    expect(error).toBeDefined();
  });

  it("accepts the platform's own redrive", () => {
    const { error } = eventDetailResponseSchema.validate(
      aDetail({ lastRedrive: { at: "2026-06-16T11:05:00.000Z", by: "System" } }),
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

const aHop = (overrides = {}) => ({
  service: "gas",
  box: "outbox",
  id: "665f1c2e9a1b2c3d4e5f6a7b",
  hop: "GAS Outbox",
  status: "DEAD_LETTER",
  statusLabel: "Dead letter",
  statusRole: "error",
  statusRetrying: false,
  startedAt: "2026-06-16T10:00:00.000Z",
  took: null,
  ...overrides,
});

const aPage = (overrides = {}) => ({
  ...aDetail(),
  journey: [
    aHop(),
    aHop({
      id: "665f1c2e9a1b2c3d4e5f6a7c",
      service: "caseworking",
      box: "inbox",
      hop: "CW Inbox",
      status: "COMPLETED",
      statusLabel: "Completed",
      statusRole: "success",
      took: "1.2s",
    }),
  ],
  journeyTruncated: false,
  sectionErrors: [],
  ...overrides,
});

const validatePage = (body) => eventDetailPageResponseSchema.validate(body);

describe("eventDetailPageResponseSchema", () => {
  it("is labelled EventDetailPage", () => {
    expect(eventDetailPageResponseSchema.describe().flags.label).toBe(
      "EventDetailPage",
    );
  });

  it("accepts the detail with its journey", () => {
    expect(validatePage(aPage()).error).toBeUndefined();
  });

  it("keeps every key the detail already had", () => {
    for (const key of Object.keys(aDetail())) {
      const { [key]: dropped, ...rest } = aPage();

      expect(validatePage(rest).error).toBeDefined();
    }
  });

  it("adds the journey, its truncation and the section errors", () => {
    const added = Object.keys(aPage()).filter((key) => !(key in aDetail()));

    expect(added.sort()).toEqual([
      "journey",
      "journeyTruncated",
      "sectionErrors",
    ]);
    expect(validatePage({ ...aPage(), extra: 1 }).error).toBeDefined();
  });

  it("requires every new key, so a missing section fails a test", () => {
    for (const key of ["journey", "journeyTruncated", "sectionErrors"]) {
      const { [key]: dropped, ...rest } = aPage();

      expect(validatePage(rest).error).toBeDefined();
    }
  });

  it("accepts an empty journey - an event nothing else touched", () => {
    expect(validatePage(aPage({ journey: [] })).error).toBeUndefined();
  });

  it("rejects a journey hop carrying a detail-only field", () => {
    expect(
      validatePage(aPage({ journey: [{ ...aHop(), payload: {} }] })).error,
    ).toBeDefined();
  });

  it("rejects a journey carrying list rows", () => {
    expect(validatePage(aPage({ journey: [aListRow()] })).error).toBeDefined();
  });

  // Neither page narrows to a service off a row any more, so the detail
  // stopped carrying the vocabulary that link was spelled from.
  it("rejects a service vocabulary the page has no link to spend it on", () => {
    expect(
      validatePage(aPage({ services: [{ value: "gas", label: "GAS" }] })).error,
    ).toBeDefined();
  });
});

describe("journeyHopSchema", () => {
  it("is labelled JourneyHop", () => {
    expect(journeyHopSchema.describe().flags.label).toBe("JourneyHop");
  });

  it("accepts one hop", () => {
    expect(journeyHopSchema.validate(aHop()).error).toBeUndefined();
  });

  it("requires every key, so a mapping gap fails a test", () => {
    for (const key of Object.keys(aHop())) {
      const { [key]: _dropped, ...without } = aHop();

      expect(journeyHopSchema.validate(without).error).toBeDefined();
    }
  });

  it("accepts a null took", () => {
    expect(
      journeyHopSchema.validate(aHop({ took: null })).error,
    ).toBeUndefined();
  });

  it("rejects a null startedAt", () => {
    expect(
      journeyHopSchema.validate(aHop({ startedAt: null })).error,
    ).toBeDefined();
  });

  it("accepts a status outside the documented values", () => {
    expect(
      journeyHopSchema.validate(
        aHop({ status: "SOMETHING_ELSE", statusLabel: "SOMETHING_ELSE" }),
      ).error,
    ).toBeUndefined();
  });

  it("rejects a statusRole outside the five the frontend styles", () => {
    expect(
      journeyHopSchema.validate(aHop({ statusRole: "danger" })).error,
    ).toBeDefined();
  });
});

describe("eventDetailPageResponseSchema nullable journey", () => {
  // One page of a merged list: an event with more hops than a page loses the
  // oldest of them, and a page that shows four of six without saying so
  // answers "where did this go?" wrongly and looks right doing it.
  it("states whether hops were left off the end", () => {
    expect(
      validatePage(aPage({ journeyTruncated: true })).error,
    ).toBeUndefined();
    const { journeyTruncated, ...withoutFlag } = aPage();

    expect(validatePage(withoutFlag).error).toBeDefined();
    expect(journeyTruncated).toBe(false);
  });

  it("accepts a null journey alongside its sectionError", () => {
    expect(
      validatePage(
        aPage({
          journey: null,
          sectionErrors: [{ section: "journey", message: "read failed" }],
        }),
      ).error,
    ).toBeUndefined();
  });

  // The event is the page: it has no null to offer.
  it("rejects a null sectionErrors and a null detail field", () => {
    expect(validatePage(aPage({ sectionErrors: null })).error).toBeDefined();
    expect(validatePage(aPage({ attemptHistory: null })).error).toBeDefined();
  });

  it("rejects a section name outside the one this page has", () => {
    expect(
      validatePage(
        aPage({ sectionErrors: [{ section: "counts", message: "boom" }] }),
      ).error,
    ).toBeDefined();
  });

  it("rejects a section error carrying anything beyond section and message", () => {
    expect(
      validatePage(
        aPage({
          sectionErrors: [
            { section: "journey", message: "read failed", body: "SECRET" },
          ],
        }),
      ).error,
    ).toBeDefined();
  });
});
