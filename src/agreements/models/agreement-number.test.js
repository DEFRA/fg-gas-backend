import { describe, expect, it } from "vitest";
import { generateAgreementNumber } from "./agreement-number.js";

describe("generate agreement number", () => {
  it("uses the configured prefix and 9 random digits", () => {
    const agreementNumber = generateAgreementNumber({
      prefix: "PMF",
      randomInt: () => 12345,
    });

    expect(agreementNumber).toBe("PMF000012345");
  });
});
