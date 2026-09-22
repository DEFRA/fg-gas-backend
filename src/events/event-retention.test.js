import { describe, expect, it } from "vitest";
import { expiryFrom } from "./event-retention.js";

const COMPLETED_AT = new Date("2026-09-17T16:18:00.000Z");
const DAY_MS = 86_400_000;

describe("expiryFrom", () => {
  it("is the given number of days after the instant given", () => {
    expect(expiryFrom(COMPLETED_AT, 90)).toEqual(
      new Date("2026-12-16T16:18:00.000Z"),
    );
  });

  it("answers a Date, the only type the TTL index acts on", () => {
    expect(expiryFrom(COMPLETED_AT, 90)).toBeInstanceOf(Date);
  });

  it("takes the retention period from its caller, not from a constant", () => {
    expect(expiryFrom(COMPLETED_AT, 30).getTime()).toBe(
      COMPLETED_AT.getTime() + 30 * DAY_MS,
    );
    expect(expiryFrom(COMPLETED_AT, 365).getTime()).toBe(
      COMPLETED_AT.getTime() + 365 * DAY_MS,
    );
  });

  it("counts a day as 24 hours across a UK clock change", () => {
    const beforeTheChange = new Date("2026-10-24T23:30:00.000Z");

    expect(expiryFrom(beforeTheChange, 2)).toEqual(
      new Date("2026-10-26T23:30:00.000Z"),
    );
  });

  it("accepts an instant written as a string", () => {
    expect(expiryFrom("2026-09-17T16:18:00.000Z", 90)).toEqual(
      new Date("2026-12-16T16:18:00.000Z"),
    );
  });

  it("leaves the instant it was given untouched", () => {
    const from = new Date(COMPLETED_AT);

    expiryFrom(from, 90);

    expect(from).toEqual(COMPLETED_AT);
  });
});
