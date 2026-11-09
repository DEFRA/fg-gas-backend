import { describe, expect, it } from "vitest";
import { endOfUkDay } from "./end-of-uk-day.js";

describe("endOfUkDay", () => {
  it.each([
    ["a GMT day", "2026-01-15T10:00:00.000Z", "2026-01-15T23:59:59.000Z"],
    ["a BST day", "2026-07-01T10:00:00.000Z", "2026-07-01T22:59:59.000Z"],
    [
      "just before UK midnight in BST",
      "2026-07-01T22:59:59.999Z",
      "2026-07-01T22:59:59.000Z",
    ],
    [
      "after UK midnight in BST, still the UTC day before",
      "2026-07-01T23:30:00.000Z",
      "2026-07-02T22:59:59.000Z",
    ],
    [
      "the last GMT evening before BST",
      "2026-03-28T23:30:00.000Z",
      "2026-03-28T23:59:59.000Z",
    ],
    [
      "the day the clocks go forward, before they do",
      "2026-03-29T00:30:00.000Z",
      "2026-03-29T22:59:59.000Z",
    ],
    [
      "the day the clocks go forward, after they do",
      "2026-03-29T01:30:00.000Z",
      "2026-03-29T22:59:59.000Z",
    ],
    [
      "the day the clocks go back, before they do",
      "2026-10-24T23:30:00.000Z",
      "2026-10-25T23:59:59.000Z",
    ],
    [
      "the day the clocks go back, after they do",
      "2026-10-25T01:30:00.000Z",
      "2026-10-25T23:59:59.000Z",
    ],
    [
      "the day after the clocks go back",
      "2026-10-25T23:30:00.000Z",
      "2026-10-25T23:59:59.000Z",
    ],
  ])("ends %s at 23:59:59 UK time", (_, instant, end) => {
    expect(endOfUkDay(new Date(instant))).toEqual(new Date(end));
  });
});
