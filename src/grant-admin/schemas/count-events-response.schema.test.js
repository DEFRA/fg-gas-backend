import { describe, expect, it } from "vitest";
import { countEventsResponseSchema } from "./count-events-response.schema.js";

const allSix = () => ({
  PUBLISHED: 1,
  PROCESSING: 2,
  FAILED: 3,
  RESUBMITTED: 4,
  COMPLETED: 5,
  DEAD_LETTER: 6,
});

const aResponse = (overrides = {}) => ({
  counts: allSix(),
  sourceErrors: [],
  ...overrides,
});

describe("countEventsResponseSchema", () => {
  it("is labelled CountEventsResponse", () => {
    expect(countEventsResponseSchema.describe().flags.label).toBe(
      "CountEventsResponse",
    );
  });

  it("accepts every status and no source errors", () => {
    expect(
      countEventsResponseSchema.validate(aResponse()).error,
    ).toBeUndefined();
  });

  it("accepts zeros", () => {
    const counts = Object.fromEntries(
      Object.keys(allSix()).map((key) => [key, 0]),
    );

    expect(
      countEventsResponseSchema.validate(aResponse({ counts })).error,
    ).toBeUndefined();
  });

  it("requires every status, so a zero-fill gap fails a test", () => {
    const { DEAD_LETTER, ...counts } = allSix();

    expect(
      countEventsResponseSchema.validate(aResponse({ counts })).error,
    ).toBeDefined();
  });

  it("rejects a status outside the six", () => {
    expect(
      countEventsResponseSchema.validate(
        aResponse({ counts: { ...allSix(), NONSENSE: 1 } }),
      ).error,
    ).toBeDefined();
  });

  it("carries source errors in the same shape the list uses", () => {
    expect(
      countEventsResponseSchema.validate(
        aResponse({
          sourceErrors: [
            { service: "caseworking", box: "inbox", message: "timeout" },
          ],
        }),
      ).error,
    ).toBeUndefined();
  });

  it("rejects a source error that leaks anything beyond the fixed one-liner", () => {
    expect(
      countEventsResponseSchema.validate(
        aResponse({
          sourceErrors: [
            {
              service: "caseworking",
              box: "inbox",
              message: "timeout",
              body: "SECRET",
            },
          ],
        }),
      ).error,
    ).toBeDefined();
  });

  it("requires every key, so a missing facet block fails a test", () => {
    for (const key of ["counts", "sourceErrors"]) {
      const { [key]: dropped, ...rest } = aResponse();

      expect(countEventsResponseSchema.validate(rest).error).toBeDefined();
    }
  });

  // Both service-shaped blocks are gone - the SERVICE segments are plain
  // labels, and the TYPE control they sat beside went before them - and a
  // block a caller offers is rejected rather than silently carried.
  it("rejects a byService block", () => {
    expect(
      countEventsResponseSchema.validate(
        aResponse({ byService: { gas: 1, caseworking: 2 } }),
      ).error,
    ).toBeDefined();
  });

  it("rejects a byKind block", () => {
    expect(
      countEventsResponseSchema.validate(
        aResponse({ byKind: { domain: 1, audit: 2 } }),
      ).error,
    ).toBeDefined();
  });

  it("answers with counts and sourceErrors and nothing else", () => {
    expect(Object.keys(aResponse()).sort()).toEqual(["counts", "sourceErrors"]);
    expect(
      countEventsResponseSchema.validate(aResponse()).error,
    ).toBeUndefined();
  });

  // `total` was the sum of the seven numbers in `counts`, sent beside them.
  // The caller adds them up now, so one offered here is refused rather than
  // silently carried.
  it("rejects a total block", () => {
    expect(
      countEventsResponseSchema.validate(aResponse({ total: 21 })).error,
    ).toBeDefined();
  });

  it("rejects a negative or fractional count", () => {
    expect(
      countEventsResponseSchema.validate(
        aResponse({ counts: { ...allSix(), FAILED: -1 } }),
      ).error,
    ).toBeDefined();
  });

  it("accepts zeros everywhere - an empty estate is still a valid answer", () => {
    expect(
      countEventsResponseSchema.validate(
        aResponse({
          counts: Object.fromEntries(
            Object.keys(allSix()).map((key) => [key, 0]),
          ),
        }),
      ).error,
    ).toBeUndefined();
  });
});
