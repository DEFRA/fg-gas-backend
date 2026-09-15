import { describe, expect, it } from "vitest";
import {
  eventPaginationSchema,
  eventRowSchema,
  eventRowWithAttemptsSchema,
  eventSourceErrorSchema,
} from "./events-shared.schema.js";

const ticketEvent = {
  service: "gas",
  box: "outbox",
  id: "665f1c2e9a1b2c3d4e5f6a7b",
  eventId: "3f2c1a0e-0000-4000-8000-000000000000",
  type: "case.status.updated",
  status: "DEAD_LETTER",
  statusLabel: "Dead letter",
  statusRole: "error",
  statusRetrying: false,
  createdAt: "2026-06-16T10:00:00.000Z",
  latency: null,
  latencyTitle: "Queued to delivered to SNS",
};

const {
  latency: _latency,
  latencyTitle: _latencyTitle,
  ...baseEvent
} = ticketEvent;

const singleRowEvent = {
  ...baseEvent,
  attempts: "5/5",
  targetTopic: "gas__sns__update_case_status_fifo.fifo",
  lastError: {
    name: "ClaimExpired",
    message: "claim expired before completion",
    at: "2026-06-16T10:16:05.000Z",
  },
};

const validRow = (overrides) =>
  eventRowSchema.validate({ ...ticketEvent, ...overrides }).error;

describe("eventRowSchema", () => {
  it("accepts a list row", () => {
    expect(validRow()).toBeUndefined();
  });

  it("accepts a status outside the documented values", () => {
    expect(validRow({ status: "SOMETHING_ELSE" })).toBeUndefined();
  });

  it("accepts the audit label", () => {
    expect(validRow({ type: "audit" })).toBeUndefined();
  });

  it("rejects a null type - every row states what it is", () => {
    expect(validRow({ type: null })).toBeDefined();
  });

  it("requires the type key", () => {
    const { type: _type, ...rest } = ticketEvent;

    expect(eventRowSchema.validate(rest).error).toBeDefined();
  });

  it("rejects an unknown key", () => {
    expect(validRow({ unknown: true })).toBeDefined();
  });

  it.each([
    ["not ISO-8601", "16 Jun 2026"],
    ["a Date", new Date()],
  ])("rejects a createdAt that is %s", (_name, createdAt) => {
    expect(validRow({ createdAt })).toBeDefined();
  });

  it("rejects a statusRole outside the five the frontend styles", () => {
    expect(validRow({ statusRole: "danger" })).toBeDefined();
  });

  it("requires latency and its title", () => {
    for (const key of ["latency", "latencyTitle"]) {
      const { [key]: _dropped, ...event } = ticketEvent;

      expect(eventRowSchema.validate(event).error).toBeDefined();
    }
  });
});

describe("eventPaginationSchema", () => {
  it("accepts a next page and a last page with no cursor", () => {
    expect(
      eventPaginationSchema.validate({
        endCursor: "eyJ2IjoxfQ",
        hasNextPage: true,
      }).error,
    ).toBeUndefined();
    expect(
      eventPaginationSchema.validate({ endCursor: null, hasNextPage: false })
        .error,
    ).toBeUndefined();
  });
});

describe("eventSourceErrorSchema", () => {
  it.each(["GAS Outbox", "CW-BE Inbox"])("accepts the hop %s", (hop) => {
    expect(eventSourceErrorSchema.validate({ hop }).error).toBeUndefined();
  });

  it("requires a hop", () => {
    expect(eventSourceErrorSchema.validate({}).error).toBeDefined();
  });
});

describe("eventRowWithAttemptsSchema lastError", () => {
  const withLastError = (lastError) =>
    eventRowWithAttemptsSchema.validate({ ...singleRowEvent, lastError });

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

  it("rejects a single row with no lastError key at all", () => {
    const { lastError, ...withoutLastError } = singleRowEvent;

    expect(
      eventRowWithAttemptsSchema.validate(withoutLastError).error,
    ).toBeDefined();
  });
});

describe("eventRowWithAttemptsSchema", () => {
  it("accepts the single-row shape the detail carries", () => {
    expect(
      eventRowWithAttemptsSchema.validate(singleRowEvent).error,
    ).toBeUndefined();
  });

  it("rejects a numeric attempts", () => {
    expect(
      eventRowWithAttemptsSchema.validate({ ...singleRowEvent, attempts: 5 })
        .error,
    ).toBeDefined();
  });

  it("accepts a redriven row with 0 attempts", () => {
    expect(
      eventRowWithAttemptsSchema.validate({
        ...singleRowEvent,
        attempts: "0/5",
        status: "RESUBMITTED",
      }).error,
    ).toBeUndefined();
  });

  it("accepts a null targetTopic on an inbox row", () => {
    expect(
      eventRowWithAttemptsSchema.validate({
        ...singleRowEvent,
        box: "inbox",
        targetTopic: null,
      }).error,
    ).toBeUndefined();
  });

  it("rejects the list's latency", () => {
    expect(
      eventRowWithAttemptsSchema.validate({ ...singleRowEvent, latency: null })
        .error,
    ).toBeDefined();
  });
});
