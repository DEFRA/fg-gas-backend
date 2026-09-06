import { describe, expect, it } from "vitest";
import { Payment } from "./payment.js";

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

describe("Payment", () => {
  it("generates an id, correlation ID and timestamp when created", () => {
    const payment = Payment.create(props);

    expect(payment.id).toEqual(expect.any(String));
    expect(payment.correlationId).toEqual(expect.any(String));
    expect(payment.createdAt).toEqual(expect.any(String));
  });

  it("is immutable once created", () => {
    const payment = Payment.create(props);

    expect(() => {
      payment.totalAmountPence = 1;
    }).toThrow(TypeError);
    expect(() => {
      payment.payments[0].invoiceLines[0].amountPence = 1;
    }).toThrow(TypeError);
    expect(payment.totalAmountPence).toBe(3800);
  });

  it("rejects non integer pence", () => {
    expect(() => Payment.create({ ...props, totalAmountPence: 38.5 })).toThrow(
      "Invalid Payment",
    );
  });

  it("rejects a Payment with no claim ID", () => {
    expect(() =>
      Payment.create({ ...props, paymentHubClaimId: undefined }),
    ).toThrow("Invalid Payment");
  });

  it("rejects a Payment with no due payments", () => {
    expect(() => Payment.create({ ...props, payments: [] })).toThrow(
      "Invalid Payment",
    );
  });

  it("strips unknown properties", () => {
    const payment = Payment.create({ ...props, notAField: "dropped" });

    expect(payment.notAField).toBeUndefined();
  });
});
