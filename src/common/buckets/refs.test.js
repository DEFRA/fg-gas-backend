import { describe, expect, it } from "vitest";
import { toRef, toRefs, toTraceId } from "./refs.js";

describe("toRef", () => {
  it("writes kind:value, trimmed and lower-cased", () => {
    expect(toRef("ref", "  ABC-123-xyz ")).toBe("ref:abc-123-xyz");
  });

  it("writes a number as its string", () => {
    expect(toRef("sbi", 900000001)).toBe("sbi:900000001");
  });

  it.each([null, undefined, "", "   "])("answers null for %j", (value) => {
    expect(toRef("ref", value)).toBeNull();
  });
});

describe("toRefs", () => {
  it("drops nulls and duplicates", () => {
    expect(
      toRefs([
        ["ref", "abc-123"],
        ["ref", "ABC-123"],
        ["sbi", null],
        ["agreement", "FPTT000000001"],
      ]),
    ).toEqual(["ref:abc-123", "agreement:fptt000000001"]);
  });

  it("answers an empty list for no pairs", () => {
    expect(toRefs([])).toEqual([]);
  });
});

describe("toTraceId", () => {
  it("answers the 32-hex part of a W3C traceparent", () => {
    expect(
      toTraceId("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"),
    ).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("answers the whole value when it is not W3C", () => {
    expect(toTraceId("0b7c1d1e-0000-4000-8000-000000000001")).toBe(
      "0b7c1d1e-0000-4000-8000-000000000001",
    );
  });

  it.each([null, undefined])("answers %s as it is", (value) => {
    expect(toTraceId(value)).toBe(value);
  });
});
