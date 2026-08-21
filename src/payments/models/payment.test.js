import { describe, expect, it } from "vitest";
import { Payment } from "./payment.js";

const paymentConfiguration = {
  sbi: "106284736",
  frn: "1101234567",
  scheme: "SFI",
  sourceSystem: "FPTT",
  deliveryBody: "RP00",
  fesCode: "FALS_FPTT",
  originalInvoiceNumber: "",
  ledger: "AP",
  totalAmountPence: 3800,
  currency: "GBP",
  marketingYear: "2026",
  payments: [
    {
      dueDate: "2026-11-06",
      totalAmountPence: 3800,
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

const props = {
  ...paymentConfiguration,
  source: {
    type: "agreement",
    agreementNumber: "PMF123456789",
    version: 2,
  },
  paymentHubClaimId: "R00000001",
  paymentRequestNumber: 1,
  invoiceNumber: "R00000001-V001QX",
  payments: paymentConfiguration.payments.map((duePayment) => ({
    ...duePayment,
    status: "pending",
    correlationId: "9665924f-41b7-43d2-8f68-a17c88c05e42",
  })),
};

const forAgreement = (overrides = {}) =>
  Payment.forAgreement({
    agreementNumber: "PMF123456789",
    version: 2,
    agreementCorrelationId: "123e4567-e89b-12d3-a456-426614174000",
    paymentConfiguration,
    paymentHubClaimId: "R00000001",
    ...overrides,
  });

const complete = {
  ...props,
  id: "payment-1",
  correlationId: "123e4567-e89b-12d3-a456-426614174000",
  createdAt: "2026-08-01T10:00:00.000Z",
};

describe("Payment", () => {
  it("is immutable once created", () => {
    const payment = new Payment({
      ...complete,
      id: "payment-1",
      correlationId: "c-1",
      createdAt: "2026-08-01T10:00:00.000Z",
    });

    expect(() => {
      payment.totalAmountPence = 1;
    }).toThrow(TypeError);
    expect(() => {
      payment.payments[0].invoiceLines[0].amountPence = 1;
    }).toThrow(TypeError);
    expect(payment.totalAmountPence).toBe(3800);
  });

  it("rejects non integer pence", () => {
    expect(() => new Payment({ ...complete, totalAmountPence: 38.5 })).toThrow(
      "Invalid Payment",
    );
  });

  it("rejects a Payment with no claim ID", () => {
    expect(
      () => new Payment({ ...complete, paymentHubClaimId: undefined }),
    ).toThrow("Invalid Payment");
  });

  it("rejects a Payment with no due payments", () => {
    expect(() => new Payment({ ...complete, payments: [] })).toThrow(
      "Invalid Payment",
    );
  });

  it("strips unknown properties", () => {
    const payment = new Payment({ ...complete, notAField: "dropped" });

    expect(payment.notAField).toBeUndefined();
  });
});

describe("Payment.forAgreement", () => {
  it("uses every resolved business field from the Payment definition", () => {
    expect(forAgreement()).toMatchObject(paymentConfiguration);
  });

  it("records the Agreement Number and version as its source", () => {
    expect(forAgreement().source).toEqual({
      type: "agreement",
      agreementNumber: "PMF123456789",
      version: 2,
    });
  });

  it("adds platform-owned identifiers, statuses and timestamps", () => {
    const payment = forAgreement();

    expect(payment.id).toEqual(expect.any(String));
    expect(payment.correlationId).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(payment.paymentHubClaimId).toBe("R00000001");
    expect(payment.paymentRequestNumber).toBe(1);
    expect(payment.invoiceNumber).toBe("R00000001-V001QX");
    expect(payment.payments[0].status).toBe("pending");
    expect(payment.payments[0].correlationId).toEqual(expect.any(String));
    expect(payment.createdAt).toEqual(expect.any(String));
  });

  // Configuration cannot reach a platform field: the Payment Definition schema
  // forbids these keys, and the factory overwrites them regardless.
  it("ignores platform fields carried on the resolved configuration", () => {
    const payment = forAgreement({
      paymentConfiguration: {
        ...paymentConfiguration,
        paymentRequestNumber: 99,
        invoiceNumber: "FORGED",
        source: { type: "agreement", agreementNumber: "OTHER", version: 99 },
      },
    });

    expect(payment.paymentRequestNumber).toBe(1);
    expect(payment.invoiceNumber).toBe("R00000001-V001QX");
    expect(payment.source.agreementNumber).toBe("PMF123456789");
  });

  it("reports a missing definition as a server configuration error", () => {
    try {
      forAgreement({ paymentConfiguration: undefined });
      throw new Error("Expected Payment.forAgreement to throw");
    } catch (error) {
      expect(error.output.statusCode).toBe(500);
      expect(error.message).toBe(
        "A Payment requires a resolved Payment Definition",
      );
    }
  });

  it("requires the Agreement Correlation ID", () => {
    expect(() => forAgreement({ agreementCorrelationId: undefined })).toThrow(
      "Agreement Correlation ID",
    );
  });

  it("rejects an unbalanced resolved Payment", () => {
    expect(() =>
      forAgreement({
        paymentConfiguration: {
          ...paymentConfiguration,
          totalAmountPence: 9999,
        },
      }),
    ).toThrow("totalAmountPence does not balance with its payments");
  });

  it("rejects an unbalanced resolved due Payment", () => {
    const configuration = structuredClone(paymentConfiguration);
    configuration.payments[0].totalAmountPence = 9999;
    configuration.totalAmountPence = 9999;

    expect(() => forAgreement({ paymentConfiguration: configuration })).toThrow(
      "does not balance with its invoice lines",
    );
  });
});
