import { describe, expect, it } from "vitest";
import { buildPayment } from "./build-payment.js";

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

const build = (overrides = {}) =>
  buildPayment({
    agreementNumber: "PMF123456789",
    version: 2,
    agreementCorrelationId: "123e4567-e89b-12d3-a456-426614174000",
    paymentConfiguration,
    paymentHubClaimId: "R00000001",
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
  it("uses every resolved business field from the Payment definition", () => {
    expect(build()).toMatchObject(paymentConfiguration);
  });

  it("records the Agreement Number and version as its source", () => {
    expect(build().source).toEqual({
      type: "agreement",
      agreementNumber: "PMF123456789",
      version: 2,
    });
  });

  it("adds platform-owned identifiers, statuses and timestamps", () => {
    const payment = build();

    expect(payment.id).toEqual(expect.any(String));
    expect(payment.correlationId).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(payment.paymentHubClaimId).toBe("R00000001");
    expect(payment.paymentRequestNumber).toBe(1);
    expect(payment.invoiceNumber).toBe("R00000001-V001QX");
    expect(payment.payments[0].status).toBe("pending");
    expect(payment.payments[0].correlationId).toEqual(expect.any(String));
    expect(payment.createdAt).toEqual(expect.any(String));
  });

  it("reports a missing definition as a server configuration error", () => {
    const error = getBuildError({ paymentConfiguration: undefined });

    expect(error.output.statusCode).toBe(500);
    expect(error.message).toBe(
      "createPayment requires a compiled Payment definition",
    );
  });

  it("requires the Agreement Correlation ID", () => {
    expect(() => build({ agreementCorrelationId: undefined })).toThrow(
      "Agreement Correlation ID",
    );
  });

  it("rejects an unbalanced resolved Payment", () => {
    expect(() =>
      build({
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

    expect(() => build({ paymentConfiguration: configuration })).toThrow(
      "does not balance with its invoice lines",
    );
  });
});
