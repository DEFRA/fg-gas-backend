import { describe, expect, it } from "vitest";
import { isPlainObject } from "./is-plain-object.js";

describe("isPlainObject", () => {
  it.each([
    ["empty object", {}, true],
    ["object with values", { value: 1 }, true],
    ["array", [], false],
    ["null", null, false],
    ["date", new Date("2026-07-19T00:00:00.000Z"), false],
    ["object without a prototype", Object.create(null), false],
    ["string", "value", false],
    ["number", 42, false],
  ])("classifies a %s", (_name, value, expected) => {
    expect(isPlainObject(value)).toBe(expected);
  });
});
