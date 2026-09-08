import { describe, expect, it } from "vitest";
import { eventStatusCountsSchema } from "./event-status-counts.schema.js";

const allSix = () => ({
  PUBLISHED: 1,
  PROCESSING: 2,
  FAILED: 3,
  RESUBMITTED: 4,
  COMPLETED: 5,
  DEAD_LETTER: 6,
});

const zeros = () =>
  Object.fromEntries(Object.keys(allSix()).map((key) => [key, 0]));

describe("eventStatusCountsSchema", () => {
  it("is labelled EventStatusCounts", () => {
    expect(eventStatusCountsSchema.describe().flags.label).toBe(
      "EventStatusCounts",
    );
  });

  it("accepts every status", () => {
    expect(eventStatusCountsSchema.validate(allSix()).error).toBeUndefined();
  });

  it("accepts zeros everywhere - an empty estate is still a valid answer", () => {
    expect(eventStatusCountsSchema.validate(zeros()).error).toBeUndefined();
  });

  it("requires every status, so a zero-fill gap fails a test", () => {
    const { DEAD_LETTER, ...missing } = allSix();

    expect(eventStatusCountsSchema.validate(missing).error).toBeDefined();
  });

  it("rejects a status outside the six", () => {
    expect(
      eventStatusCountsSchema.validate({ ...allSix(), NONSENSE: 1 }).error,
    ).toBeDefined();
  });

  // Nothing outside the six statuses belongs in this object.
  it.each(["total", "byService", "byKind"])(
    "rejects a leftover %s block",
    (key) => {
      expect(
        eventStatusCountsSchema.validate({ ...allSix(), [key]: 21 }).error,
      ).toBeDefined();
    },
  );

  it("rejects a negative or fractional count", () => {
    expect(
      eventStatusCountsSchema.validate({ ...allSix(), FAILED: -1 }).error,
    ).toBeDefined();
    expect(
      eventStatusCountsSchema.validate({ ...allSix(), FAILED: 1.5 }).error,
    ).toBeDefined();
  });
});
