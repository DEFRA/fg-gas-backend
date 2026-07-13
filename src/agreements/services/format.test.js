import { describe, expect, it } from "vitest";
import { applyFormat } from "./format.js";

describe("applyFormat", () => {
  describe("poundsNoDecimals", () => {
    it("formats a whole number as pounds with thousands separators", () => {
      expect(applyFormat(1234, "poundsNoDecimals")).toBe("£1,234");
    });

    it("rounds a fractional amount to the nearest pound", () => {
      expect(applyFormat(1234.6, "poundsNoDecimals")).toBe("£1,235");
    });

    it("throws when the value is not numeric", () => {
      expect(() => applyFormat("not-a-number", "poundsNoDecimals")).toThrow(
        'Cannot format "not-a-number" as poundsNoDecimals',
      );
    });

    it("throws for null instead of silently formatting it as zero", () => {
      expect(() => applyFormat(null, "poundsNoDecimals")).toThrow(
        'Cannot format "null" as poundsNoDecimals',
      );
    });

    it("throws for a boolean instead of silently formatting it as zero", () => {
      expect(() => applyFormat(false, "poundsNoDecimals")).toThrow(
        'Cannot format "false" as poundsNoDecimals',
      );
    });

    it("throws for an empty string instead of silently formatting it as zero", () => {
      expect(() => applyFormat("", "poundsNoDecimals")).toThrow(
        'Cannot format "" as poundsNoDecimals',
      );
    });

    it("throws for an array instead of silently formatting it as zero", () => {
      expect(() => applyFormat([], "poundsNoDecimals")).toThrow(
        'Cannot format "" as poundsNoDecimals',
      );
    });
  });

  it("throws for an unsupported format name", () => {
    expect(() => applyFormat(1, "unknownFormat")).toThrow(
      'Unsupported format "unknownFormat"',
    );
  });
});
