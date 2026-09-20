import { describe, expect, it } from "vitest";
import { eventsPageQuerySchema } from "./events-page-query.schema.js";

const FROM = "2026-06-16T00:00:00.000Z";
const TO = "2026-06-16T23:59:59.999Z";

const validate = (query) => eventsPageQuerySchema.validate(query);

describe("eventsPageQuerySchema", () => {
  it("is labelled EventsPageQuery", () => {
    expect(eventsPageQuerySchema.describe().flags.label).toBe(
      "EventsPageQuery",
    );
  });

  it("accepts an empty query, with no status or service and audit excluded", () => {
    const { error, value } = validate({});

    expect(error).toBeUndefined();
    expect(value).toEqual({ audit: "exclude" });
  });

  it("accepts every filter at once and keeps each as given", () => {
    const query = {
      cursor: "eyJ2IjoxfQ",
      status: "DEAD_LETTER",
      service: "caseworking",
      q: "GLD-9B2",
      error: "No handler found",
      from: FROM,
      to: TO,
      audit: "include",
    };

    const { error, value } = validate(query);

    expect(error).toBeUndefined();
    expect(value).toEqual(query);
  });

  it.each([
    ["a status outside the six", { status: "BOGUS" }],
    ["a service outside the two", { service: "other" }],
    ["a q over 200 characters", { q: "a".repeat(201) }],
    ["an error over 1024 characters", { error: "x".repeat(1025) }],
    ["an audit mode outside the two", { audit: "all" }],
    ["a non-string audit mode", { audit: true }],
    ["an empty audit mode", { audit: "" }],
    ["a bound that is not an ISO date", { from: "yesterday" }],
    ["an unknown parameter", { pageSize: "50" }],
  ])("rejects %s", (_name, query) => {
    expect(validate(query).error).toBeDefined();
  });

  it.each([
    ["q", 200],
    ["error", 1024],
  ])("accepts a %s of the maximum length", (key, length) => {
    expect(validate({ [key]: "x".repeat(length) }).error).toBeUndefined();
  });

  it.each(["q", "error"])(
    "trims %s and treats an empty or whitespace-only value as absent",
    (key) => {
      expect(validate({ [key]: "  evt-1  " }).value[key]).toBe("evt-1");
      expect(validate({ [key]: "" }).value[key]).toBeUndefined();
      expect(validate({ [key]: "   " }).value[key]).toBeUndefined();
    },
  );
});

describe("eventsPageQuerySchema from and to", () => {
  it("keeps the bounds as strings", () => {
    const { value } = validate({ from: FROM, to: TO });

    expect(value.from).toBe(FROM);
    expect(value.to).toBe(TO);
  });

  it("accepts either bound on its own, and equal bounds", () => {
    expect(validate({ from: FROM }).error).toBeUndefined();
    expect(validate({ to: TO }).error).toBeUndefined();
    expect(validate({ from: FROM, to: FROM }).error).toBeUndefined();
  });

  it("rejects from after to", () => {
    expect(validate({ from: TO, to: FROM }).error.message).toBe(
      '"from" must be earlier than or equal to "to"',
    );
  });

  it("compares the bounds as instants, not as strings", () => {
    expect(
      validate({ from: FROM, to: "2026-06-16T01:00:00.000+02:00" }).error,
    ).toBeDefined();
  });
});
