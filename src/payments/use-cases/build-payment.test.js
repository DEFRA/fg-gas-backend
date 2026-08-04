import { describe, expect, it } from "vitest";
import { buildPayment } from "./build-payment.js";

const mapping = {
  scheme: "SFI",
  sourceSystem: "FPTT",
  deliveryBody: "RP00",
  fesCode: "FALS_FPTT",
  ledger: "AP",
  currency: "GBP",
  invoiceLine: {
    schemeCode: "CMOR1",
    accountCode: "SOS710",
    fundCode: "DRD10",
  },
};

const paymentCalculation = {
  agreementStartDate: "2026-08-01",
  agreementEndDate: "2027-07-31",
  agreementTotalPence: 3800,
  payments: [
    {
      dueDate: "2026-11-06",
      totalAmountPence: 3800,
      invoiceLines: [
        {
          pigType: "largeWhite",
          description: "Large White Pig",
          quantity: 2,
          unitPricePence: 1000,
          amountPence: 2000,
        },
        {
          pigType: "berkshire",
          description: "Berkshire",
          quantity: 1,
          unitPricePence: 1800,
          amountPence: 1800,
        },
      ],
    },
  ],
};

const build = (overrides = {}) =>
  buildPayment({
    agreementNumber: "PMF123456789",
    version: 2,
    sbi: "106284736",
    frn: "1101234567",
    paymentCalculation,
    mapping,
    paymentHubClaimId: "R00000001",
    marketingYear: "2026",
    ...overrides,
  });

const getBuildError = (overrides) => {
  try {
    build(overrides);
  } catch (error) {
    return error;
  }

  throw new Error("Expected buildPayment to throw");
};

describe("buildPayment", () => {
  it("records the Agreement Number and version as its source", () => {
    expect(build().source).toEqual({
      type: "agreement",
      agreementNumber: "PMF123456789",
      version: 2,
    });
  });

  it("resolves scheme specific settings from the definition mapping", () => {
    const payment = build();

    expect(payment).toMatchObject({
      scheme: "SFI",
      sourceSystem: "FPTT",
      deliveryBody: "RP00",
      fesCode: "FALS_FPTT",
      ledger: "AP",
      currency: "GBP",
    });
    expect(payment.payments[0].invoiceLines[0]).toMatchObject({
      schemeCode: "CMOR1",
      accountCode: "SOS710",
      fundCode: "DRD10",
      deliveryBody: "RP00",
    });
  });

  it("turns each payment due into one entry in payments", () => {
    const payment = build();

    expect(payment.payments).toHaveLength(1);
    expect(payment.payments[0]).toMatchObject({
      dueDate: "2026-11-06",
      totalAmountPence: 3800,
    });
  });

  it("generates the identifiers, status and timestamps not held in config", () => {
    const payment = build();

    expect(payment.id).toEqual(expect.any(String));
    expect(payment.correlationId).toEqual(expect.any(String));
    expect(payment.payments[0].correlationId).toEqual(expect.any(String));
    expect(payment.payments[0].correlationId).not.toBe(payment.correlationId);
    expect(payment.paymentRequestNumber).toBe(1);
    expect(payment.invoiceNumber).toBe("R00000001-V001QX");
    expect(payment.originalInvoiceNumber).toBe("");
    expect(payment.payments[0].status).toBe("pending");
    expect(payment.createdAt).toEqual(expect.any(String));
  });

  it("carries the identifiers and integer pence totals", () => {
    const payment = build();

    expect(payment.sbi).toBe("106284736");
    expect(payment.frn).toBe("1101234567");
    expect(payment.totalAmountPence).toBe(3800);
    expect(
      payment.payments[0].invoiceLines.map((line) => line.amountPence),
    ).toEqual([2000, 1800]);
  });

  it("defaults the marketing year to the current year", () => {
    const payment = build({ marketingYear: undefined });

    expect(payment.marketingYear).toBe(new Date().getFullYear().toString());
    expect(payment.payments[0].invoiceLines[0].marketingYear).toBe(
      payment.marketingYear,
    );
  });

  it("reports a missing definition mapping as a server configuration error", () => {
    const error = getBuildError({ mapping: undefined });

    expect(error.output.statusCode).toBe(500);
    expect(error.message).toBe(
      "createPayment requires a mapping from the Agreement Definition",
    );
  });

  it("reports a calculation with no payments as an upstream error", () => {
    const error = getBuildError({
      paymentCalculation: { payments: [] },
    });

    expect(error.output.statusCode).toBe(502);
    expect(error.message).toBe(
      "createPayment requires a payment calculation with at least one payment",
    );
  });

  it("rejects a calculation whose total does not balance", () => {
    expect(() =>
      build({
        paymentCalculation: {
          ...paymentCalculation,
          agreementTotalPence: 9999,
        },
      }),
    ).toThrow("totalAmountPence does not balance with its payments");
  });

  it("rejects a due payment that does not balance with its invoice lines", () => {
    expect(() =>
      build({
        paymentCalculation: {
          ...paymentCalculation,
          agreementTotalPence: 9999,
          payments: [
            { ...paymentCalculation.payments[0], totalAmountPence: 9999 },
          ],
        },
      }),
    ).toThrow("does not balance with its invoice lines");
  });

  it("rejects a source with no identifiers", () => {
    expect(() => build({ sbi: undefined, frn: undefined })).toThrow(
      "Invalid Payment",
    );
  });
});
