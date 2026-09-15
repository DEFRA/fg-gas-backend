import { describe, expect, it, vi } from "vitest";
import {
  VARIANT_PATTERN,
  logConfigurationVariant,
  variantFileName,
} from "./configuration-variant.js";

describe("variantFileName", () => {
  it("returns the original file when variant is undefined", () => {
    expect(variantFileName("gas.json", undefined)).toBe("gas.json");
  });

  it("returns the original file when variant is empty string", () => {
    expect(variantFileName("gas.json", "")).toBe("gas.json");
  });

  it("returns the original file when variant is null", () => {
    expect(variantFileName("gas.json", null)).toBe("gas.json");
  });

  it('inserts the variant before .json ("gas.json" + "next" = "gas.next.json")', () => {
    expect(variantFileName("gas.json", "next")).toBe("gas.next.json");
  });

  it("works with nested file names like agreement.json", () => {
    expect(variantFileName("agreement.json", "next")).toBe(
      "agreement.next.json",
    );
  });

  it("works with a multi-segment variant", () => {
    expect(variantFileName("gas.json", "abc-123")).toBe("gas.abc-123.json");
  });
});

describe("VARIANT_PATTERN", () => {
  it.each(["next", "abc-123", "v2", "a"])('accepts valid value "%s"', (val) => {
    expect(VARIANT_PATTERN.test(val)).toBe(true);
  });

  it.each(["Next", "abc_123", "a b", "a.b", ""])(
    'rejects invalid value "%s"',
    (val) => {
      expect(VARIANT_PATTERN.test(val)).toBe(false);
    },
  );
});

describe("logConfigurationVariant", () => {
  it("does nothing when rawVariant is falsy", () => {
    const log = { info: vi.fn(), warn: vi.fn() };

    logConfigurationVariant({ variant: "", rawVariant: "" }, "dev", log);

    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('logs a warning when cdpEnvironment is "prod" and rawVariant is set', () => {
    const log = { info: vi.fn(), warn: vi.fn() };

    logConfigurationVariant({ variant: "", rawVariant: "next" }, "prod", log);

    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("ignored because ENVIRONMENT is prod"),
    );
    expect(log.info).not.toHaveBeenCalled();
  });

  it("logs info when variant is active outside prod", () => {
    const log = { info: vi.fn(), warn: vi.fn() };

    logConfigurationVariant(
      { variant: "next", rawVariant: "next" },
      "dev",
      log,
    );

    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('Configuration variant "next" active'),
    );
    expect(log.warn).not.toHaveBeenCalled();
  });
});
