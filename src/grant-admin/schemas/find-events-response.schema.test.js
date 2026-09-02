import { describe, expect, it } from "vitest";
import { findEventsResponseSchema } from "./find-events-response.schema.js";

const ticketEvent = {
  service: "gas",
  box: "outbox",
  id: "665f1c2e9a1b2c3d4e5f6a7b",
  eventId: "3f2c1a0e-0000-4000-8000-000000000000",
  type: "case.status.updated",
  fullType: "cloud.defra.prd.fg-gas-backend.case.update.status",
  source: null,
  target: "cw__sns__update_status_fifo",
  segregationRef: "GLD-9B2-BWS-grasslands",
  status: "DEAD_LETTER",
  attempts: 5,
  maxAttempts: 5,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  createdAt: "2026-06-16T10:00:00.000Z",
  lastFailureAt: "2026-06-16T10:16:05.000Z",
  completedAt: null,
};

const payload = (overrides = {}) => ({
  events: [ticketEvent],
  pagination: {
    startCursor: "eyJ2IjoxfQ",
    endCursor: "eyJ2IjoxfQ",
    hasNextPage: true,
    hasPreviousPage: false,
  },
  sourceErrors: [{ service: "caseworking", box: "inbox", message: "timeout" }],
  ...overrides,
});

describe("findEventsResponseSchema", () => {
  it("accepts the ticket's example payload verbatim", () => {
    const { error } = findEventsResponseSchema.validate(payload());

    expect(error).toBeUndefined();
  });

  it("accepts null source, target, segregationRef, fullType, lastFailureAt and completedAt", () => {
    const { error } = findEventsResponseSchema.validate(
      payload({
        events: [
          {
            ...ticketEvent,
            source: null,
            target: null,
            segregationRef: null,
            fullType: null,
            lastFailureAt: null,
            completedAt: null,
          },
        ],
      }),
    );

    expect(error).toBeUndefined();
  });

  it("accepts a status outside the six documented values", () => {
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

  it("requires traceId on every event", () => {
    const { traceId, ...event } = ticketEvent;

    expect(traceId).toBeDefined();
    expect(
      findEventsResponseSchema.validate(payload({ events: [event] })).error,
    ).toBeDefined();
  });

  it("accepts a null traceId", () => {
    const { error } = findEventsResponseSchema.validate(
      payload({ events: [{ ...ticketEvent, traceId: null }] }),
    );

    expect(error).toBeUndefined();
  });

  it("accepts a bare CDP request id as traceId", () => {
    const { error } = findEventsResponseSchema.validate(
      payload({ events: [{ ...ticketEvent, traceId: "cdp-request-1" }] }),
    );

    expect(error).toBeUndefined();
  });

  it("rejects a non-string traceId", () => {
    const { error } = findEventsResponseSchema.validate(
      payload({ events: [{ ...ticketEvent, traceId: 42 }] }),
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

  it("rejects attempts below 1 and non-integer maxAttempts", () => {
    expect(
      findEventsResponseSchema.validate(
        payload({ events: [{ ...ticketEvent, attempts: 0 }] }),
      ).error,
    ).toBeDefined();

    expect(
      findEventsResponseSchema.validate(
        payload({ events: [{ ...ticketEvent, maxAttempts: 2.5 }] }),
      ).error,
    ).toBeDefined();
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
          { service: "gas", box: "outbox", message: "read failed" },
          { service: "caseworking", box: "inbox", message: "not configured" },
        ],
      }),
    );

    expect(error).toBeUndefined();
  });
});
