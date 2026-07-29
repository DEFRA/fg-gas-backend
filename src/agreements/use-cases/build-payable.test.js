import { describe, expect, it } from "vitest";
import { Agreement } from "../models/agreement.js";
import { buildPayable } from "./build-payable.js";

const agreement = new Agreement({
  agreementNumber: "PMF123456789",
  version: 2,
  code: "pigs-might-fly",
  clientRef: "client",
  configVersion: "1.1.0",
  correlationId: "correlation",
  identifiers: { sbi: "106284736", frn: "1101234567" },
  payload: {},
  state: "accepted",
  createdAt: "2026-08-01T10:30:00.000Z",
  updatedAt: "2026-08-01T10:30:00.000Z",
});

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
  buildPayable({
    agreement,
    paymentCalculation,
    mapping,
    paymentHubClaimId: "R00000001",
    marketingYear: "2026",
    ...overrides,
  });

describe("buildPayable", () => {
  it("records the Agreement Number and version as its source", () => {
    expect(build().source).toEqual({
      type: "agreement",
      agreementNumber: "PMF123456789",
      version: 2,
    });
  });

  it("resolves scheme specific settings from the definition mapping", () => {
    const payable = build();

    expect(payable).toMatchObject({
      scheme: "SFI",
      sourceSystem: "FPTT",
      deliveryBody: "RP00",
      fesCode: "FALS_FPTT",
      ledger: "AP",
      currency: "GBP",
    });
    expect(payable.payments[0].invoiceLines[0]).toMatchObject({
      schemeCode: "CMOR1",
      accountCode: "SOS710",
      fundCode: "DRD10",
      deliveryBody: "RP00",
    });
  });

  it("generates the identifiers, status and timestamps not held in config", () => {
    const payable = build();

    expect(payable.id).toEqual(expect.any(String));
    expect(payable.correlationId).toEqual(expect.any(String));
    expect(payable.payments[0].correlationId).toEqual(expect.any(String));
    expect(payable.payments[0].correlationId).not.toBe(payable.correlationId);
    expect(payable.paymentRequestNumber).toBe(1);
    expect(payable.invoiceNumber).toBe("R00000001-V001QX");
    expect(payable.originalInvoiceNumber).toBe("");
    expect(payable.payments[0].status).toBe("pending");
    expect(payable.createdAt).toEqual(expect.any(String));
  });

  it("carries the identifiers and integer pence totals", () => {
    const payable = build();

    expect(payable.sbi).toBe("106284736");
    expect(payable.frn).toBe("1101234567");
    expect(payable.totalAmountPence).toBe(3800);
    expect(payable.payments[0].invoiceLines.map((l) => l.amountPence)).toEqual([
      2000, 1800,
    ]);
  });

  it("defaults the marketing year to the current year", () => {
    const payable = build({ marketingYear: undefined });

    expect(payable.marketingYear).toBe(new Date().getFullYear().toString());
    expect(payable.payments[0].invoiceLines[0].marketingYear).toBe(
      payable.marketingYear,
    );
  });

  it("rejects a missing mapping", () => {
    expect(() => build({ mapping: undefined })).toThrow(
      "createPayable requires a mapping from the Agreement Definition",
    );
  });

  it("rejects a calculation with no payments", () => {
    expect(() => build({ paymentCalculation: { payments: [] } })).toThrow(
      "createPayable requires a payment calculation with at least one payment",
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

  it("rejects a payment that does not balance with its invoice lines", () => {
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

  it("rejects an Agreement with no identifiers", () => {
    const withoutIdentifiers = new Agreement({ ...agreement, identifiers: {} });

    expect(() => build({ agreement: withoutIdentifiers })).toThrow(
      "Invalid Payable",
    );
  });
});
