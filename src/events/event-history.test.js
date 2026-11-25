import { describe, expect, it } from "vitest";
import {
  MAX_EDIT_BEFORE_IMAGES,
  appendHistory,
  deadLetteredEntry,
  pushHistory,
} from "./event-history.js";

describe("deadLetteredEntry", () => {
  it("is stamped with the instant it is given", () => {
    expect(deadLetteredEntry("2026-06-16T10:05:00.000Z")).toEqual({
      kind: "dead-lettered",
      at: "2026-06-16T10:05:00.000Z",
    });
  });

  it("is stamped with this service's clock, to the millisecond, otherwise", () => {
    expect(deadLetteredEntry().at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });
});

describe("appendHistory", () => {
  it("appends the entry as a literal to the stored history, or to none", () => {
    const entry = {
      kind: "redriven",
      at: "2026-06-16T11:00:00.000Z",
      by: "$x",
    };

    expect(appendHistory(entry)).toEqual({
      $concatArrays: [{ $ifNull: ["$history", []] }, [{ $literal: entry }]],
    });
  });
});

describe("pushHistory", () => {
  it("pushes each entry", () => {
    const entry = deadLetteredEntry();

    expect(pushHistory([entry])).toEqual({
      $push: { history: { $each: [entry] } },
    });
  });

  it("adds no $push when there is nothing to record", () => {
    expect(pushHistory([])).toEqual({});
  });
});

describe("MAX_EDIT_BEFORE_IMAGES", () => {
  it("keeps the before-images of the 5 newest edits", () => {
    expect(MAX_EDIT_BEFORE_IMAGES).toBe(5);
  });
});
