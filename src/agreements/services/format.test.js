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

  describe("poundsFromPence", () => {
    it("formats whole pounds without decimal places", () => {
      expect(applyFormat(32000, "poundsFromPence")).toBe("£320");
    });

    it("preserves pence when the amount is not a whole pound", () => {
      expect(applyFormat(32050, "poundsFromPence")).toBe("£320.50");
    });

    it("throws when the value is not numeric", () => {
      expect(() => applyFormat("no", "poundsFromPence")).toThrow(
        'Cannot format "no" as poundsFromPence',
      );
    });
  });

  describe("dateLong", () => {
    it("formats an ISO date in long form", () => {
      expect(applyFormat("2026-11-06", "dateLong")).toBe("6 November 2026");
    });

    it("throws when the value is not a date", () => {
      expect(() => applyFormat("not-a-date", "dateLong")).toThrow(
        'Cannot format "not-a-date" as dateLong',
      );
    });
  });

  it("throws for an unsupported format name", () => {
    expect(() => applyFormat(1, "unknownFormat")).toThrow(
      'Unsupported format "unknownFormat"',
    );
  });
});
