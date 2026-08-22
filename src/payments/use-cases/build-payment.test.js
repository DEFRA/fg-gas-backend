import { describe, expect, it } from "vitest";
import { buildPayment } from "./build-payment.js";

const resolved = {
  sbi: "106284736",
  frn: "1101234567",
  scheme: "SFI",
  sourceSystem: "FPTT",
  deliveryBody: "RP00",
  fesCode: "FALS_FPTT",
  ledger: "AP",
  totalAmountPence: 3800,
  currency: "GBP",
  marketingYear: "2026",
  duePayments: [
    {
      dueDate: "2026-11-06",
      totalAmountPence: 2000,
      invoiceLines: [
        {
          schemeCode: "CMOR1",
          description: "Large White Pig",
          amountPence: 2000,
          accountCode: "SOS710",
          fundCode: "DRD10",
        },
      ],
    },
    {
      dueDate: "2027-02-06",
      totalAmountPence: 1800,
      invoiceLines: [
        {
          schemeCode: "CMOR1",
          description: "Berkshire",
          amountPence: 1800,
          accountCode: "SOS710",
          fundCode: "DRD10",
        },
      ],
    },
  ],
};

const build = (overrides = {}) =>
  buildPayment({
    agreementNumber: "PMF123456789",
    version: 2,
    agreementCorrelationId: "123e4567-e89b-12d3-a456-426614174000",
    resolved,
    paymentHubClaimId: "R00000001",
    createdAt: "2026-08-20T10:00:00.000Z",
    ...overrides,
  });

describe("buildPayment", () => {
  it("records the Agreement Number and version as its source", () => {
    expect(build().source).toEqual({
      type: "agreement",
      agreementNumber: "PMF123456789",
      version: 2,
    });
  });

  it("uses the resolved Payment fields", () => {
    expect(build()).toMatchObject({
      sbi: "106284736",
      frn: "1101234567",
      scheme: "SFI",
      sourceSystem: "FPTT",
      deliveryBody: "RP00",
      fesCode: "FALS_FPTT",
      ledger: "AP",
      totalAmountPence: 3800,
      currency: "GBP",
      marketingYear: "2026",
    });
  });

  it("turns each resolved due payment into one Payment entry", () => {
    const payment = build();

    expect(payment.payments).toHaveLength(2);
    expect(payment.payments).toMatchObject([
      {
        dueDate: "2026-11-06",
        totalAmountPence: 2000,
        invoiceLines: [
          {
            schemeCode: "CMOR1",
            description: "Large White Pig",
            amountPence: 2000,
            accountCode: "SOS710",
            fundCode: "DRD10",
          },
        ],
      },
      {
        dueDate: "2027-02-06",
        totalAmountPence: 1800,
      },
    ]);
  });

  it("generates identifiers, due correlations, status and timestamps", () => {
    const payment = build();

    expect(payment.id).toEqual(expect.any(String));
    expect(payment.correlationId).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(payment.payments[0].correlationId).toEqual(expect.any(String));
    expect(payment.payments[0].correlationId).not.toBe(payment.correlationId);
    expect(payment.payments[1].correlationId).not.toBe(
      payment.payments[0].correlationId,
    );
    expect(payment.paymentRequestNumber).toBe(1);
    expect(payment.invoiceNumber).toBe("R00000001-V001QX");
    expect(payment.originalInvoiceNumber).toBe("");
    expect(payment.payments.every(({ status }) => status === "pending")).toBe(
      true,
    );
    expect(payment.createdAt).toBe("2026-08-20T10:00:00.000Z");
  });

  it("keeps pence numeric", () => {
    const payment = build();

    expect(payment.totalAmountPence).toBe(3800);
    expect(
      payment.payments.map(({ totalAmountPence }) => totalAmountPence),
    ).toEqual([2000, 1800]);
    expect(
      payment.payments.map(({ invoiceLines }) => invoiceLines[0].amountPence),
    ).toEqual([2000, 1800]);
  });

  it("copies top-level delivery body and marketing year onto invoice lines", () => {
    const payment = build();

    expect(payment.payments[0].invoiceLines[0]).toMatchObject({
      deliveryBody: "RP00",
      marketingYear: "2026",
    });
    expect(payment.payments[1].invoiceLines[0]).toMatchObject({
      deliveryBody: "RP00",
      marketingYear: "2026",
    });
  });

  it("requires the Agreement Correlation ID for grant-level correlation", () => {
    expect(() => build({ agreementCorrelationId: undefined })).toThrow(
      "Agreement Correlation ID",
    );
  });
});
