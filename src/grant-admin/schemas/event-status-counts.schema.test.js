import { describe, expect, it } from "vitest";
import { eventStatusCountsSchema } from "./event-status-counts.schema.js";

const allSeven = () => ({
  PUBLISHED: 1,
  PROCESSING: 2,
  FAILED: 3,
  RESUBMITTED: 4,
  COMPLETED: 5,
  DEAD_LETTER: 6,
  PURGED: 7,
});

const zeros = () =>
  Object.fromEntries(Object.keys(allSeven()).map((key) => [key, 0]));

describe("eventStatusCountsSchema", () => {
  it("is labelled EventStatusCounts", () => {
    expect(eventStatusCountsSchema.describe().flags.label).toBe(
      "EventStatusCounts",
    );
  });

  it("accepts every status", () => {
    expect(eventStatusCountsSchema.validate(allSeven()).error).toBeUndefined();
  });

  it("accepts zeros everywhere - an empty estate is still a valid answer", () => {
    expect(eventStatusCountsSchema.validate(zeros()).error).toBeUndefined();
  });

  it("requires every status, so a zero-fill gap fails a test", () => {
    const { DEAD_LETTER, ...missing } = allSeven();

    expect(eventStatusCountsSchema.validate(missing).error).toBeDefined();
  });

  it("rejects a status outside the seven", () => {
    expect(
      eventStatusCountsSchema.validate({ ...allSeven(), NONSENSE: 1 }).error,
    ).toBeDefined();
  });

  it("rejects a negative or fractional count", () => {
    expect(
      eventStatusCountsSchema.validate({ ...allSeven(), FAILED: -1 }).error,
    ).toBeDefined();
    expect(
      eventStatusCountsSchema.validate({ ...allSeven(), FAILED: 1.5 }).error,
    ).toBeDefined();
  });
});
