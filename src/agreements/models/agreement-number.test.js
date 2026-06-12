import { describe, expect, it } from "vitest";
import { generateAgreementNumber } from "./agreement-number.js";

describe("generate agreement number", () => {
  it("uses the configured prefix and random digit count", () => {
    const agreementNumber = generateAgreementNumber({
      config: {
        prefix: "PMF",
        randomDigits: 9,
      },
      randomInt: () => 12345,
    });

    expect(agreementNumber).toBe("PMF000012345");
  });
});
