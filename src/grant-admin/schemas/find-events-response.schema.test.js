import { describe, expect, it } from "vitest";
import {
  eventRowWithAttemptsSchema,
  findEventsResponseSchema,
} from "./find-events-response.schema.js";

const ticketEvent = {
  service: "gas",
  box: "outbox",
  id: "665f1c2e9a1b2c3d4e5f6a7b",
  eventId: "3f2c1a0e-0000-4000-8000-000000000000",
  type: "case.status.updated",
  hop: "GAS Outbox",
  queue: "to Caseworking",
  queueValue: "gas__sns__update_case_status_fifo.fifo",
  status: "DEAD_LETTER",
  statusLabel: "Dead letter",
  statusRole: "error",
  statusRetrying: false,
  createdAt: "2026-06-16T10:00:00.000Z",
  lastError: {
    name: "ClaimExpired",
    message: "claim expired before completion",
    at: "2026-06-16T10:16:05.000Z",
  },
  latency: null,
  latencyTitle: "Queued to delivered to SNS",
};

// The single-row shape behind the detail and redrive answers: the same row
// carrying the attempt facts the list is no longer sent, and none of the
// list's duration figures.
const { latency: _latency, latencyTitle: _latencyTitle, ...baseEvent } = ticketEvent;

const singleRowEvent = {
  ...baseEvent,
  attempts: "5/5",
  showAttempts: true,
  lastFailureAt: "2026-06-16T10:16:05.000Z",
};

const payload = (overrides = {}) => ({
  events: [ticketEvent],
  pagination: {
    startCursor: "eyJ2IjoxfQ",
    endCursor: "eyJ2IjoxfQ",
    hasNextPage: true,
    hasPreviousPage: false,
  },
  sourceErrors: [
    {
      service: "caseworking",
      box: "inbox",
      hop: "CW Inbox",
      message: "timeout",
    },
  ],
  ...overrides,
});

describe("findEventsResponseSchema", () => {
  it("accepts the ticket's example payload verbatim", () => {
    const { error } = findEventsResponseSchema.validate(payload());

    expect(error).toBeUndefined();
  });

  // An outbox row that names no target has no queue line to draw, and a row
  // that has not completed has no duration to report.
  it("accepts a null queue, queueValue, lastError and latency", () => {
    const { error } = findEventsResponseSchema.validate(
      payload({
        events: [
          {
            ...ticketEvent,
            queue: null,
            queueValue: null,
            lastError: null,
            latency: null,
          },
        ],
      }),
    );

    expect(error).toBeUndefined();
  });

  it("accepts a status outside the documented values", () => {
    const { error } = findEventsResponseSchema.validate(
      payload({ events: [{ ...ticketEvent, status: "SOMETHING_ELSE" }] }),
    );

    expect(error).toBeUndefined();
  });

  it("rejects a payload carrying an `event` key", () => {
    const { error } = findEventsResponseSchema.validate(
      payload({ events: [{ ...ticketEvent, event: { data: {} } }] }),
    );

    expect(error).toBeDefined();
  });

  it("rejects a payload carrying a `kind` key", () => {
    const { error } = findEventsResponseSchema.validate(
      payload({ events: [{ ...ticketEvent, kind: "audit" }] }),
    );

    expect(error).toBeDefined();
  });

  // A row that stores no type is labelled by the mapper, so a null reaching
  // the wire is a derivation gap and fails here.
  it("rejects a null type - every row states what it is", () => {
    expect(
      findEventsResponseSchema.validate(
        payload({ events: [{ ...ticketEvent, type: null }] }),
      ).error,
    ).toBeDefined();
  });

  it("accepts the audit label", () => {
    const { error } = findEventsResponseSchema.validate(
      payload({ events: [{ ...ticketEvent, type: "audit" }] }),
    );

    expect(error).toBeUndefined();
  });

  it("rejects a row carrying a full type", () => {
    expect(
      findEventsResponseSchema.validate(
        payload({
          events: [
            {
              ...ticketEvent,
              fullType: "cloud.defra.prd.fg-gas-backend.case.update.status",
            },
          ],
        }),
      ).error,
    ).toBeDefined();
  });

  it("still requires the type key itself, so a mapping gap fails a test", () => {
    const { type, ...rest } = ticketEvent;

    expect(
      findEventsResponseSchema.validate(payload({ events: [rest] })).error,
    ).toBeDefined();
  });

  it("rejects a row carrying a traceId", () => {
    const { error } = findEventsResponseSchema.validate(
      payload({
        events: [
          { ...ticketEvent, traceId: "4bf92f3577b34da6a3ce929d0e0e4736" },
        ],
      }),
    );

    expect(error).toBeDefined();
  });

  it("rejects an event carrying a raw traceparent", () => {
    const { error } = findEventsResponseSchema.validate(
      payload({
        events: [
          {
            ...ticketEvent,
            traceparent:
              "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
          },
        ],
      }),
    );

    expect(error).toBeDefined();
  });

  it("rejects a `createdAt` that is not ISO-8601", () => {
    const { error } = findEventsResponseSchema.validate(
      payload({ events: [{ ...ticketEvent, createdAt: "16 Jun 2026" }] }),
    );

    expect(error).toBeDefined();
  });

  it("rejects a Date rather than an ISO string for createdAt", () => {
    const { error } = findEventsResponseSchema.validate(
      payload({ events: [{ ...ticketEvent, createdAt: new Date() }] }),
    );

    expect(error).toBeDefined();
  });

  it("rejects a maxAttempts of its own", () => {
    expect(
      findEventsResponseSchema.validate(
        payload({ events: [{ ...ticketEvent, maxAttempts: 5 }] }),
      ).error,
    ).toBeDefined();
  });

  // The list stopped drawing an attempt count, so it stopped being sent one:
  // a row carrying the attempt facts is a row the list has no column for.
  it.each(["attempts", "showAttempts", "lastFailureAt"])(
    "rejects %s on a list row",
    (key) => {
      expect(
        findEventsResponseSchema.validate(
          payload({ events: [{ ...ticketEvent, [key]: "5/5" }] }),
        ).error,
      ).toBeDefined();
    },
  );
  // Anything unrecognised keeps its own spelling and a neutral badge, but the
  // colour itself is a closed set: a role the frontend has no styling for is
  // a derivation gap.
  it("rejects a statusRole outside the five the frontend styles", () => {
    expect(
      findEventsResponseSchema.validate(
        payload({ events: [{ ...ticketEvent, statusRole: "danger" }] }),
      ).error,
    ).toBeDefined();
  });

  // The list is the only surface that draws a duration, so the shared base
  // row - which the detail and the redrive answer with - has none.
  it("requires latency and its title on every list row", () => {
    for (const key of ["latency", "latencyTitle"]) {
      const { [key]: _dropped, ...event } = ticketEvent;

      expect(
        findEventsResponseSchema.validate(payload({ events: [event] })).error,
      ).toBeDefined();
    }
  });

  it("accepts an empty page with null cursors", () => {
    const { error } = findEventsResponseSchema.validate({
      events: [],
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

  it("accepts a gas sourceError as well as a caseworking one", () => {
    const { error } = findEventsResponseSchema.validate(
      payload({
        sourceErrors: [
          {
            service: "gas",
            box: "outbox",
            hop: "GAS Outbox",
            message: "read failed",
          },
          {
            service: "caseworking",
            box: "inbox",
            hop: "CW Inbox",
            message: "not configured",
          },
        ],
      }),
    );

    expect(error).toBeUndefined();
  });

  // The alert above the table and the rows in it must name a source one way.
  it("requires a hop on every sourceError", () => {
    const [{ hop: _dropped, ...sourceError }] = payload().sourceErrors;

    expect(
      findEventsResponseSchema.validate(
        payload({ sourceErrors: [sourceError] }),
      ).error,
    ).toBeDefined();
  });
});

describe("findEventsResponseSchema lastError", () => {
  const withLastError = (lastError) =>
    findEventsResponseSchema.validate(
      payload({ events: [{ ...ticketEvent, lastError }] }),
    );

  it("accepts a null lastError", () => {
    expect(withLastError(null).error).toBeUndefined();
  });

  it("accepts a lastError with a null at", () => {
    expect(
      withLastError({ name: "Error", message: "boom", at: null }).error,
    ).toBeUndefined();
  });

  it("accepts an empty message", () => {
    expect(
      withLastError({
        name: "Error",
        message: "",
        at: "2026-06-16T10:16:05.000Z",
      }).error,
    ).toBeUndefined();
  });

  it("rejects a lastError missing its name", () => {
    expect(
      withLastError({ message: "boom", at: "2026-06-16T10:16:05.000Z" }).error,
    ).toBeDefined();
  });

  it("rejects an extra key such as a stack", () => {
    expect(
      withLastError({
        name: "Error",
        message: "boom",
        at: "2026-06-16T10:16:05.000Z",
        stack: "SECRET",
      }).error,
    ).toBeDefined();
  });

  it("rejects an event with no lastError key at all", () => {
    const { lastError, ...withoutLastError } = ticketEvent;

    expect(
      findEventsResponseSchema.validate(payload({ events: [withoutLastError] }))
        .error,
    ).toBeDefined();
  });
});

describe("eventRowWithAttemptsSchema", () => {
  it("accepts the single-row shape the detail and redrive answers carry", () => {
    expect(eventRowWithAttemptsSchema.validate(singleRowEvent).error).toBeUndefined();
  });

  it("rejects a numeric attempts", () => {
    expect(
      eventRowWithAttemptsSchema.validate({ ...singleRowEvent, attempts: 5 })
        .error,
    ).toBeDefined();
  });

  // a redriven row sits at 0 attempts until the resubmission sweep $inc-s it
  it("accepts a redriven row with 0 attempts", () => {
    expect(
      eventRowWithAttemptsSchema.validate({
        ...singleRowEvent,
        attempts: "0/5",
        status: "RESUBMITTED",
      }).error,
    ).toBeUndefined();
  });

  it("accepts a null lastFailureAt on a row that never failed", () => {
    expect(
      eventRowWithAttemptsSchema.validate({
        ...singleRowEvent,
        lastFailureAt: null,
      }).error,
    ).toBeUndefined();
  });

  // The list's duration figures belong to the list row alone.
  it("rejects the list's latency", () => {
    expect(
      eventRowWithAttemptsSchema.validate({ ...singleRowEvent, latency: null })
        .error,
    ).toBeDefined();
  });
});
