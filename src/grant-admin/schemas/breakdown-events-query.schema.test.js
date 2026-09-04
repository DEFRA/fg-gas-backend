import { describe, expect, it } from "vitest";
import { breakdownEventsQuerySchema } from "./breakdown-events-query.schema.js";

const validate = (query) => breakdownEventsQuerySchema.validate(query);

describe("breakdownEventsQuerySchema", () => {
  it("accepts the counts selection", () => {
    expect(
      validate({
        service: "gas",
        q: "GLD-9B2",
        from: "2026-06-16T00:00:00.000Z",
        to: "2026-06-16T23:59:59.999Z",
      }).error,
    ).toBeUndefined();
  });

  it("accepts an empty query - the breakdown of everything", () => {
    expect(validate({}).error).toBeUndefined();
  });

  // The TYPE filter is gone: `kind` is rejected as any unknown parameter is.
  it("rejects kind as an unknown parameter", () => {
    expect(validate({ kind: "audit" }).error).toBeDefined();
  });

  it("rejects a status - the scope is always and only DEAD_LETTER", () => {
    expect(validate({ status: "DEAD_LETTER" }).error).toBeDefined();
  });

  it("rejects an error filter - the breakdown already answers that question", () => {
    expect(validate({ error: "boom" }).error).toBeDefined();
  });

  it("rejects a cursor and a page size - a breakdown is not paged", () => {
    expect(validate({ cursor: "eyJ2IjoxfQ" }).error).toBeDefined();
    expect(validate({ pageSize: 20 }).error).toBeDefined();
  });

  it("rejects an unknown service", () => {
    expect(validate({ service: "nope" }).error).toBeDefined();
  });

  it("rejects a reversed range with the same message the list uses", () => {
    expect(
      validate({
        from: "2026-06-17T00:00:00.000Z",
        to: "2026-06-16T00:00:00.000Z",
      }).error.message,
    ).toContain('"from" must be earlier than or equal to "to"');
  });

  it("trims `q` and treats whitespace-only as absent", () => {
    expect(validate({ q: "  GLD  " }).value.q).toBe("GLD");
    expect(validate({ q: "" }).value.q).toBeUndefined();
  });
});
