import { describe, expect, it } from "vitest";
import {
  EVENT_STATUSES,
  statusGroupStage,
  sumCounts,
  toStatusCounts,
  zeroCounts,
} from "./status-counts.js";

describe("EVENT_STATUSES", () => {
  it("is every status an inbox/outbox row can hold", () => {
    expect(EVENT_STATUSES).toEqual([
      "PUBLISHED",
      "PROCESSING",
      "FAILED",
      "RESUBMITTED",
      "COMPLETED",
      "DEAD_LETTER",
    ]);
  });
});

describe("zeroCounts", () => {
  it("has every key at zero", () => {
    expect(zeroCounts()).toEqual({
      PUBLISHED: 0,
      PROCESSING: 0,
      FAILED: 0,
      RESUBMITTED: 0,
      COMPLETED: 0,
      DEAD_LETTER: 0,
    });
  });

  it("is a fresh object each time", () => {
    const first = zeroCounts();
    first.FAILED = 9;

    expect(zeroCounts().FAILED).toBe(0);
  });
});

describe("toStatusCounts", () => {
  it("turns $group rows into counts", () => {
    expect(
      toStatusCounts([
        { _id: "FAILED", count: 3 },
        { _id: "COMPLETED", count: 7 },
      ]),
    ).toEqual({
      PUBLISHED: 0,
      PROCESSING: 0,
      FAILED: 3,
      RESUBMITTED: 0,
      COMPLETED: 7,
      DEAD_LETTER: 0,
    });
  });

  it("zero-fills every status the aggregation did not emit", () => {
    expect(toStatusCounts([{ _id: "DEAD_LETTER", count: 1 }])).toEqual({
      ...zeroCounts(),
      DEAD_LETTER: 1,
    });
  });

  it("answers all zeros for an empty or missing result", () => {
    expect(toStatusCounts([])).toEqual(zeroCounts());
    expect(toStatusCounts(undefined)).toEqual(zeroCounts());
  });

  it("ignores a rogue document's status rather than widening the shape", () => {
    const counts = toStatusCounts([
      { _id: "NONSENSE", count: 4 },
      { _id: null, count: 2 },
      { _id: "FAILED", count: 1 },
    ]);

    expect(Object.keys(counts)).toEqual(EVENT_STATUSES);
    expect(counts.FAILED).toBe(1);
  });
});

describe("sumCounts", () => {
  it("sums several sources key by key", () => {
    expect(
      sumCounts([
        { ...zeroCounts(), FAILED: 2, COMPLETED: 1 },
        { ...zeroCounts(), FAILED: 3, PUBLISHED: 5 },
      ]),
    ).toEqual({
      PUBLISHED: 5,
      PROCESSING: 0,
      FAILED: 5,
      RESUBMITTED: 0,
      COMPLETED: 1,
      DEAD_LETTER: 0,
    });
  });

  it("treats a source that answered nothing as zeros", () => {
    expect(sumCounts([{ FAILED: 2 }, undefined, {}])).toEqual({
      ...zeroCounts(),
      FAILED: 2,
    });
  });

  it("is all zeros with no sources at all", () => {
    expect(sumCounts([])).toEqual(zeroCounts());
  });
});

describe("statusGroupStage", () => {
  it("groups by status and counts", () => {
    expect(statusGroupStage()).toEqual({
      $group: { _id: "$status", count: { $sum: 1 } },
    });
  });
});
