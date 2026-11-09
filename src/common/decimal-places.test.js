import { describe, expect, it } from "vitest";
import { decimalPlaces } from "./decimal-places.js";

describe("decimalPlaces", () => {
  it.each([
    [270, 0],
    [0.5, 1],
    [1.2345, 4],
    [270.5473, 4],
    [-4.12, 2],
  ])("counts the decimal places of %d as %d", (value, expected) => {
    expect(decimalPlaces(value)).toBe(expected);
  });

  it("counts the places floating-point error adds", () => {
    expect(decimalPlaces(0.1 + 0.2)).toBe(17);
    expect(decimalPlaces(270.54729999999995)).toBe(14);
  });

  it.each([
    [1e-7, 7],
    [1.5e-7, 8],
    [1e21, 0],
  ])("counts the places %d in exponent form stands for", (value, expected) => {
    expect(decimalPlaces(value)).toBe(expected);
  });
});
