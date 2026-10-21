import { describe, expect, it } from "vitest";
import { ExternalStatusMapping } from "./external-status-mapping.js";

const targetOf = (mappedTo) =>
  new ExternalStatusMapping(
    { code: "IN_REVIEW", source: "CW", mappedTo },
    { phase: "PRE_AWARD", stage: "REVIEW" },
  ).target?.toString();

describe("ExternalStatusMapping", () => {
  it.each([
    ["a status in its stage", "::HELD", "PRE_AWARD:REVIEW:HELD"],
    ["a bare status in its stage", "HELD", "PRE_AWARD:REVIEW:HELD"],
    [
      "a fully qualified position",
      "POST_AWARD:MONITORING:ACCEPTED",
      "POST_AWARD:MONITORING:ACCEPTED",
    ],
  ])("targets %s", (_label, mappedTo, position) => {
    expect(targetOf(mappedTo)).toBe(position);
  });

  it.each([
    ["two parts", "REVIEW:HELD"],
    ["four parts", "A:B:C:D"],
  ])("targets nothing when mapped to %s", (_label, mappedTo) => {
    expect(targetOf(mappedTo)).toBeUndefined();
  });
});
