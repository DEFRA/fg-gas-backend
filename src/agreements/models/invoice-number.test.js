import { describe, expect, it } from "vitest";
import { generateInvoiceNumber } from "./invoice-number.js";

describe("generateInvoiceNumber", () => {
  it("uses default invoice number config", () => {
    expect(generateInvoiceNumber("R00000001", 1)).toBe("R00000001-V001QX");
  });

  it("uses configured invoice number parts", () => {
    expect(
      generateInvoiceNumber("R00000001", 7, {
        requestPadding: 4,
        requestPrefix: "P",
        suffix: "Z9",
      }),
    ).toBe("R00000001-P0007Z9");
  });
});
