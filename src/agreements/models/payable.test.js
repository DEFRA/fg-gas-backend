import { describe, expect, it } from "vitest";
import { Payable } from "./payable.js";

const props = {
  source: {
    type: "agreement",
    agreementNumber: "PMF123456789",
    version: 2,
  },
  sbi: "106284736",
  frn: "1101234567",
  paymentHubClaimId: "R00000001",
  scheme: "SFI",
  sourceSystem: "FPTT",
  deliveryBody: "RP00",
  fesCode: "FALS_FPTT",
  paymentRequestNumber: 1,
  invoiceNumber: "R00000001-V001QX",
  originalInvoiceNumber: "",
  ledger: "AP",
  totalAmountPence: 3800,
  currency: "GBP",
  marketingYear: "2026",
  payments: [
    {
      dueDate: "2026-11-06",
      totalAmountPence: 3800,
      status: "pending",
      correlationId: "9665924f-41b7-43d2-8f68-a17c88c05e42",
      invoiceLines: [
        {
          schemeCode: "CMOR1",
          description: "Large White Pig",
          amountPence: 2000,
          accountCode: "SOS710",
          fundCode: "DRD10",
          deliveryBody: "RP00",
          marketingYear: "2026",
        },
        {
          schemeCode: "CMOR1",
          description: "Berkshire",
          amountPence: 1800,
          accountCode: "SOS710",
          fundCode: "DRD10",
          deliveryBody: "RP00",
          marketingYear: "2026",
        },
      ],
    },
  ],
};

describe("Payable", () => {
  it("generates an id, correlation ID and timestamp when created", () => {
    const payable = Payable.create(props);

    expect(payable.id).toEqual(expect.any(String));
    expect(payable.correlationId).toEqual(expect.any(String));
    expect(payable.createdAt).toEqual(expect.any(String));
  });

  it("is immutable once created", () => {
    const payable = Payable.create(props);

    expect(() => {
      payable.totalAmountPence = 1;
    }).toThrow(TypeError);
    expect(() => {
      payable.payments[0].invoiceLines[0].amountPence = 1;
    }).toThrow(TypeError);
    expect(payable.totalAmountPence).toBe(3800);
  });

  it("rejects non integer pence", () => {
    expect(() => Payable.create({ ...props, totalAmountPence: 38.5 })).toThrow(
      "Invalid Payable",
    );
  });

  it("rejects a payable with no claim ID", () => {
    expect(() =>
      Payable.create({ ...props, paymentHubClaimId: undefined }),
    ).toThrow("Invalid Payable");
  });

  it("rejects a payable with no payments", () => {
    expect(() => Payable.create({ ...props, payments: [] })).toThrow(
      "Invalid Payable",
    );
  });

  it("strips unknown properties", () => {
    const payable = Payable.create({ ...props, notAField: "dropped" });

    expect(payable.notAField).toBeUndefined();
  });
});
