import { describe, expect, it } from "vitest";
import { redriveQueryResponseSchema } from "./redrive-query-response.schema.js";
import { redriveQuerySchema } from "./redrive-query.schema.js";

const validate = (query) => redriveQuerySchema.validate(query);

describe("redriveQuerySchema", () => {
  it("accepts the list's own filter keys", () => {
    expect(
      validate({
        service: "gas",
        q: "GLD-9B2",
        error: "boom",
        from: "2026-06-16T00:00:00.000Z",
        to: "2026-06-16T23:59:59.999Z",
        limit: 100,
      }).error,
    ).toBeUndefined();
  });

  // The TYPE filter is gone: `kind` is rejected as any unknown parameter is.
  it("rejects kind as an unknown parameter", () => {
    expect(validate({ kind: "audit" }).error).toBeDefined();
  });

  it("defaults the limit to 500", () => {
    expect(validate({}).value.limit).toBe(500);
  });

  it("caps the limit at 500 and floors it at 1", () => {
    expect(validate({ limit: 500 }).error).toBeUndefined();
    expect(validate({ limit: 501 }).error).toBeDefined();
    expect(validate({ limit: 0 }).error).toBeDefined();
    expect(validate({ limit: 1.5 }).error).toBeDefined();
  });

  it("rejects a status - the scope is implicitly DEAD_LETTER and widening it is the one dangerous thing", () => {
    expect(validate({ status: "PUBLISHED" }).error).toBeDefined();
  });

  it("rejects a cursor - this is not a paged read", () => {
    expect(validate({ cursor: "eyJ2IjoxfQ" }).error).toBeDefined();
  });

  it("rejects a reversed range with the list's own message", () => {
    expect(
      validate({
        from: "2026-06-17T00:00:00.000Z",
        to: "2026-06-16T00:00:00.000Z",
      }).error.message,
    ).toContain('"from" must be earlier than or equal to "to"');
  });

  it("caps the error filter at 512 characters, exactly as the list does", () => {
    expect(validate({ error: "x".repeat(512) }).error).toBeUndefined();
    expect(validate({ error: "x".repeat(513) }).error).toBeDefined();
  });
});

const aSource = (overrides = {}) => ({
  matched: 3,
  processed: 3,
  redriven: 2,
  conflicts: 1,
  failures: 0,
  ...overrides,
});

const aResult = (overrides = {}) => ({
  matched: 3,
  processed: 3,
  redriven: 2,
  conflicts: 1,
  failures: 0,
  perSource: { gasInbox: aSource() },
  sourceErrors: [],
  ...overrides,
});

describe("redriveQueryResponseSchema", () => {
  it("accepts a whole result", () => {
    expect(
      redriveQueryResponseSchema.validate(aResult()).error,
    ).toBeUndefined();
  });

  it("allows matched to exceed processed - limit caps the work, not the match", () => {
    expect(
      redriveQueryResponseSchema.validate(
        aResult({
          matched: 900,
          processed: 500,
          redriven: 500,
          conflicts: 0,
          perSource: {
            gasInbox: aSource({
              matched: 900,
              processed: 500,
              redriven: 500,
              conflicts: 0,
            }),
          },
        }),
      ).error,
    ).toBeUndefined();
  });

  it("accepts every source key the fan-out can produce", () => {
    const perSource = Object.fromEntries(
      ["gasInbox", "gasOutbox", "cwInbox", "cwOutbox"].map((key) => [
        key,
        aSource(),
      ]),
    );

    expect(
      redriveQueryResponseSchema.validate(aResult({ perSource })).error,
    ).toBeUndefined();
  });

  it("accepts no sources at all - nothing matched anywhere", () => {
    expect(
      redriveQueryResponseSchema.validate(
        aResult({
          matched: 0,
          processed: 0,
          redriven: 0,
          conflicts: 0,
          perSource: {},
        }),
      ).error,
    ).toBeUndefined();
  });

  it("requires every total, so a tally gap fails a test", () => {
    const { conflicts, ...result } = aResult();

    expect(redriveQueryResponseSchema.validate(result).error).toBeDefined();
  });

  it("requires sourceErrors, so a partial answer always announces itself", () => {
    const { sourceErrors, ...result } = aResult();

    expect(redriveQueryResponseSchema.validate(result).error).toBeDefined();
  });
});
