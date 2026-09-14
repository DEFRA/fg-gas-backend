import { describe, expect, it } from "vitest";
import { Payment, PaymentSourceType } from "./payment.js";

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

  // The Payment is what the Payment Service is paid from, so a total that does
  // not add up must not be constructible at all.
  it("rejects a Payment whose total does not match its due payments", () => {
    expect(() => Payment.create({ ...props, totalAmountPence: 3900 })).toThrow(
      "totalAmountPence does not balance with its payments",
    );
  });

  it("rejects a due payment that does not match its invoice lines", () => {
    const payments = structuredClone(props.payments);
    payments[0].totalAmountPence = 3700;

    expect(() =>
      Payment.create({ ...props, payments, totalAmountPence: 3700 }),
    ).toThrow("does not balance with its invoice lines");
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

  // The schema stripping an undeclared field is one guard; the constructor
  // assigning only declared fields is the other. This asserts the second on its
  // own, so a schema loosened later cannot quietly put data on a Payment.
  it("copies nothing the schema does not declare, even if it stops stripping it", () => {
    const strict = Payment.validationSchema;
    Payment.validationSchema = strict.unknown(true);

    try {
      const payment = Payment.create({ ...props, notAField: "dropped" });

      expect(payment.notAField).toBeUndefined();
    } finally {
      Payment.validationSchema = strict;
    }
  });

  describe("source", () => {
    const claimSource = {
      type: PaymentSourceType.CLAIM,
      code: "woodland",
      clientRef: "wmp-tu3-lbj",
      clientClaimRef: "WMP-TU3-LBJ-C01",
      entitlementId: "5abb45b1-6679-4a5e-92f5-3d13d7b4b74e",
      agreementNumber: "WMP-WMPTU3LBJ",
      agreementVersion: 3,
    };

    it("accepts a Claim source", () => {
      const payment = Payment.create({ ...props, source: claimSource });

      expect(payment.source).toEqual(claimSource);
    });

    it("accepts an Agreement source", () => {
      const payment = Payment.create(props);

      expect(payment.source).toEqual({
        type: PaymentSourceType.AGREEMENT,
        agreementNumber: "PMF123456789",
        version: 2,
      });
    });

    // Each source is validated against its own type, so one variant's
    // identifiers cannot stand in for the other's.
    it("rejects a Claim source identified like an Agreement", () => {
      expect(() =>
        Payment.create({
          ...props,
          source: { type: PaymentSourceType.CLAIM, agreementNumber: "WMP-1" },
        }),
      ).toThrow('"source.clientClaimRef" is required');
    });

    it("rejects an Agreement source identified like a Claim", () => {
      expect(() =>
        Payment.create({
          ...props,
          source: { ...claimSource, type: PaymentSourceType.AGREEMENT },
        }),
      ).toThrow('"source.version" is required');
    });

    it("rejects a source type it does not know", () => {
      expect(() =>
        Payment.create({ ...props, source: { type: "invoice" } }),
      ).toThrow('"source.type" must be one of [agreement, claim]');
    });

    it("rejects a source with no type", () => {
      expect(() =>
        Payment.create({ ...props, source: { code: "woodland" } }),
      ).toThrow('"source.type" is required');
    });
  });
});
