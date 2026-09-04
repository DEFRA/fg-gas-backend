import { describe, expect, it } from "vitest";
import { countEventsQuerySchema } from "./count-events-query.schema.js";

const FROM = "2026-06-16T00:00:00.000Z";
const TO = "2026-06-16T23:59:59.999Z";

const validate = (query) => countEventsQuerySchema.validate(query);

describe("countEventsQuerySchema", () => {
  it("is labelled CountEventsQuery", () => {
    expect(countEventsQuerySchema.describe().flags.label).toBe(
      "CountEventsQuery",
    );
  });

  it("accepts an empty query - counts for everything", () => {
    const { error, value } = validate({});

    expect(error).toBeUndefined();
    expect(value).toEqual({});
  });

  it("accepts the same selection the list takes", () => {
    const { error, value } = validate({
      service: "caseworking",
      q: "  GLD-9B2  ",
      from: FROM,
      to: TO,
    });

    expect(error).toBeUndefined();
    expect(value).toEqual({
      service: "caseworking",
      q: "GLD-9B2",
      from: FROM,
      to: TO,
    });
  });

  it("does NOT accept a status - counting per status is the point", () => {
    expect(validate({ status: "FAILED" }).error).toBeDefined();
  });

  it("does not accept cursor or direction", () => {
    expect(validate({ cursor: "abc" }).error).toBeDefined();
    expect(validate({ direction: "forward" }).error).toBeDefined();
  });

  it("rejects an unknown service", () => {
    expect(validate({ service: "nope" }).error).toBeDefined();
  });

  // The TYPE filter is gone: `kind` is rejected as any unknown parameter is.
  it("rejects kind as an unknown parameter", () => {
    expect(validate({ kind: "audit" }).error).toBeDefined();
  });

  it("treats a whitespace-only q as absent", () => {
    expect(validate({ q: "   " }).value.q).toBeUndefined();
    expect(validate({ q: "" }).error).toBeUndefined();
  });

  it("rejects a q longer than 200 characters", () => {
    expect(validate({ q: "a".repeat(201) }).error).toBeDefined();
    expect(validate({ q: "a".repeat(200) }).error).toBeUndefined();
  });

  it("rejects a non-ISO bound and from after to", () => {
    expect(validate({ from: "yesterday" }).error).toBeDefined();
    expect(validate({ from: TO, to: FROM }).error.message).toBe(
      '"from" must be earlier than or equal to "to"',
    );
  });

  it("accepts from equal to to", () => {
    expect(validate({ from: FROM, to: FROM }).error).toBeUndefined();
  });
});

describe("countEventsQuerySchema error", () => {
  it("takes the same error filter the list does, so the numbers describe the list", () => {
    expect(
      countEventsQuerySchema.validate({ error: "No handler found" }).error,
    ).toBeUndefined();
  });

  it("still refuses a status - counting per status is the point", () => {
    expect(
      countEventsQuerySchema.validate({ status: "DEAD_LETTER" }).error,
    ).toBeDefined();
  });
});
