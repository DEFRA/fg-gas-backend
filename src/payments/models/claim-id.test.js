import { describe, expect, it } from "vitest";
import { formatClaimId, formatInvoiceNumber } from "./claim-id.js";

describe("formatClaimId", () => {
  it("pads the sequence to the legacy R######## format", () => {
    expect(formatClaimId(1)).toBe("R00000001");
    expect(formatClaimId(42)).toBe("R00000042");
    expect(formatClaimId(12345678)).toBe("R12345678");
  });

  it("does not truncate a sequence beyond the padded width", () => {
    expect(formatClaimId(123456789)).toBe("R123456789");
  });
});

describe("formatInvoiceNumber", () => {
  it("builds the legacy invoice number from the claim ID", () => {
    expect(formatInvoiceNumber("R00000001", 1)).toBe("R00000001-V001QX");
    expect(formatInvoiceNumber("R00000042", 12)).toBe("R00000042-V012QX");
  });
});
