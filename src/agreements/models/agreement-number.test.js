import { describe, expect, it } from "vitest";
import { generateAgreementNumber } from "./agreement-number.js";

describe("generateAgreementNumber", () => {
  it("generates a number with the configured prefix and default 9-digit suffix", () => {
    const result = generateAgreementNumber({ prefix: "PMF" });
    expect(result).toMatch(/^PMF\d{9}$/);
  });

  it("uses the configured suffix length", () => {
    const result = generateAgreementNumber({ prefix: "ABC", suffixLength: 6 });
    expect(result).toMatch(/^ABC\d{6}$/);
  });

  it("always produces a suffix with the exact configured number of digits", () => {
    const results = Array.from({ length: 100 }, () =>
      generateAgreementNumber({ prefix: "X", suffixLength: 6 }),
    );
    expect(results.every((r) => r.length === 7)).toBe(true);
    expect(results.every((r) => !r.startsWith("X0"))).toBe(true);
  });

  it("throws when prefix is missing", () => {
    expect(() => generateAgreementNumber({ suffixLength: 9 })).toThrow(
      "Agreement number prefix is required",
    );
  });

  it("throws when prefix is not a string", () => {
    expect(() =>
      generateAgreementNumber({ prefix: 123, suffixLength: 9 }),
    ).toThrow("Agreement number prefix is required");
  });

  it("throws when suffixLength is zero", () => {
    expect(() =>
      generateAgreementNumber({ prefix: "PMF", suffixLength: 0 }),
    ).toThrow("suffixLength must be an integer between 1 and 14");
  });

  it("throws when suffixLength exceeds 14", () => {
    expect(() =>
      generateAgreementNumber({ prefix: "PMF", suffixLength: 15 }),
    ).toThrow("suffixLength must be an integer between 1 and 14");
  });

  it("throws when suffixLength is not an integer", () => {
    expect(() =>
      generateAgreementNumber({ prefix: "PMF", suffixLength: 1.5 }),
    ).toThrow("suffixLength must be an integer between 1 and 14");
  });
});
