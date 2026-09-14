import { describe, expect, it } from "vitest";
import { eventsPageResponseSchema } from "./events-page-response.schema.js";

const anEvent = () => ({
  service: "gas",
  box: "outbox",
  id: "665f1c2e9a1b2c3d4e5f6a7b",
  eventId: "evt-1",
  type: "case.status.updated",
  hop: "GAS Outbox",
  queue: "to Caseworking",
  queueValue: "gas__sns__update_case_status_fifo.fifo",
  status: "DEAD_LETTER",
  statusLabel: "Dead letter",
  statusRole: "error",
  statusRetrying: false,
  createdAt: "2026-06-16T10:00:00.000Z",
  lastError: { name: "Error", message: "No handler found", at: null },
  latency: null,
  latencyTitle: "Queued to delivered to SNS",
});

const statuses = () => [
  {
    value: "PUBLISHED",
    label: "Published",
    explainer: "Queued, not yet claimed",
  },
  { value: "DEAD_LETTER", label: "Dead letter", explainer: "Needs a redrive" },
];

const services = () => [
  { value: "gas", label: "GAS" },
  { value: "caseworking", label: "Caseworking" },
];

const counts = () => ({
  PUBLISHED: 0,
  PROCESSING: 0,
  FAILED: 0,
  RESUBMITTED: 0,
  COMPLETED: 0,
  DEAD_LETTER: 1,
});

const aPage = (overrides = {}) => ({
  events: [anEvent()],
  pagination: {
    startCursor: null,
    endCursor: null,
    hasNextPage: false,
    hasPreviousPage: false,
  },
  statuses: statuses(),
  services: services(),
  counts: counts(),
  breakdown: {
    groups: [
      {
        error: "No handler found",
        type: "case.status.updated",
        count: 1,
        firstAt: "2026-06-16T10:00:00.000Z",
        lastAt: "2026-06-16T10:00:00.000Z",
      },
    ],
    sourceErrors: [],
  },
  sourceErrors: [],
  sectionErrors: [],
  ...overrides,
});

const validate = (body) => eventsPageResponseSchema.validate(body);

describe("eventsPageResponseSchema", () => {
  it("is labelled EventsPageResponse", () => {
    expect(eventsPageResponseSchema.describe().flags.label).toBe(
      "EventsPageResponse",
    );
  });

  it("accepts a whole page with both sections present", () => {
    expect(validate(aPage()).error).toBeUndefined();
  });

  it("requires all eight keys, so a missing section fails a test", () => {
    for (const key of [
      "events",
      "pagination",
      "statuses",
      "services",
      "counts",
      "breakdown",
      "sourceErrors",
      "sectionErrors",
    ]) {
      const { [key]: dropped, ...rest } = aPage();

      expect(validate(rest).error).toBeDefined();
    }
  });

  it("rejects anything beyond the eight keys", () => {
    expect(validate(aPage({ total: 21 })).error).toBeDefined();
  });
});

describe("eventsPageResponseSchema filter vocabularies", () => {
  it("requires a value, a label and an explainer on every status", () => {
    for (const key of ["value", "label", "explainer"]) {
      const [{ [key]: dropped, ...status }] = statuses();

      expect(validate(aPage({ statuses: [status] })).error).toBeDefined();
    }
  });

  it("requires a value and a label on every service", () => {
    expect(
      validate(aPage({ services: [{ value: "gas" }] })).error,
    ).toBeDefined();
  });

  it.each(["statuses", "services"])("rejects a null %s", (key) => {
    expect(validate(aPage({ [key]: null })).error).toBeDefined();
  });
});

describe("eventsPageResponseSchema nullable sections", () => {
  it("accepts a null counts alongside its sectionError", () => {
    expect(
      validate(
        aPage({
          counts: null,
          sectionErrors: [{ section: "counts", message: "read failed" }],
        }),
      ).error,
    ).toBeUndefined();
  });

  it("accepts a null breakdown alongside its sectionError", () => {
    expect(
      validate(
        aPage({
          breakdown: null,
          sectionErrors: [{ section: "breakdown", message: "read failed" }],
        }),
      ).error,
    ).toBeUndefined();
  });

  it("accepts both sections null", () => {
    expect(
      validate(
        aPage({
          counts: null,
          breakdown: null,
          sectionErrors: [
            { section: "counts", message: "read failed" },
            { section: "breakdown", message: "read failed" },
          ],
        }),
      ).error,
    ).toBeUndefined();
  });

  // The list is the page: it has no null to offer.
  it.each(["events", "pagination", "sourceErrors", "sectionErrors"])(
    "rejects a null %s",
    (key) => {
      expect(validate(aPage({ [key]: null })).error).toBeDefined();
    },
  );

  it("still validates the shape of a section that is present", () => {
    expect(
      validate(aPage({ counts: { ...counts(), DEAD_LETTER: -1 } })).error,
    ).toBeDefined();
    expect(validate(aPage({ breakdown: { groups: [] } })).error).toBeDefined();
  });
});

describe("eventsPageResponseSchema sectionErrors", () => {
  it.each(["counts", "breakdown"])("accepts a %s section error", (section) => {
    expect(
      validate(aPage({ sectionErrors: [{ section, message: "read failed" }] }))
        .error,
    ).toBeUndefined();
  });

  it("rejects a section name outside the two", () => {
    expect(
      validate(
        aPage({ sectionErrors: [{ section: "events", message: "boom" }] }),
      ).error,
    ).toBeDefined();
  });

  it("rejects a section error carrying anything beyond section and message", () => {
    expect(
      validate(
        aPage({
          sectionErrors: [
            { section: "counts", message: "read failed", body: "SECRET" },
          ],
        }),
      ).error,
    ).toBeDefined();
  });

  it("requires a message on a section error", () => {
    expect(
      validate(aPage({ sectionErrors: [{ section: "counts" }] })).error,
    ).toBeDefined();
  });
});
