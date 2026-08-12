import { describe, expect, it } from "vitest";
import { buildPayment } from "./build-payment.js";

const mapping = {
  scheme: "SFI",
  sourceSystem: "FPTT",
  deliveryBody: "RP00",
  fesCode: "FALS_FPTT",
  ledger: "AP",
  currency: "GBP",
  marketingYear: "2026",
  invoiceLine: {
    schemeCode: "CMOR1",
    accountCode: "SOS710",
    fundCode: "DRD10",
  },
};

const agreementValues = {
  actions: [
    {
      id: "action:1",
      code: "largeWhite",
      description: "Large White Pig",
    },
    {
      id: "action:2",
      code: "berkshire",
      description: "Berkshire",
    },
  ],
  items: [],
  totalAmountPence: 3800,
  paymentSchedule: {
    instalments: [
      {
        id: "instalment:1",
        dueDate: "2026-11-06",
        totalAmountPence: 3800,
        lineItems: [
          { actionId: "action:1", amountPence: 2000 },
          { actionId: "action:2", amountPence: 1800 },
        ],
      },
    ],
  },
};

const build = (overrides = {}) =>
  buildPayment({
    agreementNumber: "PMF123456789",
    version: 2,
    sbi: "106284736",
    frn: "1101234567",
    agreementCorrelationId: "123e4567-e89b-12d3-a456-426614174000",
    agreementValues,
    paymentConfiguration: mapping,
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
  it("maps stored scheduled Line Items through their referenced Agreement entries", () => {
    const payment = buildPayment({
      agreementNumber: "PMF123456789",
      version: 2,
      sbi: "106284736",
      frn: "1101234567",
      agreementCorrelationId: "123e4567-e89b-12d3-a456-426614174000",
      agreementValues: {
        actions: [
          {
            id: "action:1",
            code: "largeWhite",
            description: "Large White Pig",
          },
        ],
        items: [
          {
            id: "item:1",
            code: "pigArk",
            description: "Pig ark",
          },
        ],
        totalAmountPence: 3800,
        paymentSchedule: {
          instalments: [
            {
              id: "instalment:1",
              dueDate: "2026-11-06",
              totalAmountPence: 3800,
              lineItems: [
                { actionId: "action:1", amountPence: 2000 },
                { itemId: "item:1", amountPence: 1800 },
              ],
            },
          ],
        },
      },
      paymentConfiguration: mapping,
      paymentHubClaimId: "R00000001",
    });

    expect(payment).toMatchObject({
      correlationId: "123e4567-e89b-12d3-a456-426614174000",
      totalAmountPence: 3800,
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
              description: "Pig ark",
              amountPence: 1800,
            },
          ],
        },
      ],
    });
  });

  it("keeps distinct descriptions for scoped entries that share a code", () => {
    const sharedCodeValues = structuredClone(agreementValues);
    sharedCodeValues.actions[0].code = "SHARED";
    sharedCodeValues.actions[0].parcel = "P1";
    sharedCodeValues.actions[1].code = "SHARED";
    sharedCodeValues.paymentSchedule.instalments[0].lineItems[0].description =
      "2026-11-06: Parcel: P1: Shared action";
    sharedCodeValues.paymentSchedule.instalments[0].lineItems[1].description =
      "2026-11-06: One-off payment per agreement per year for Shared action";
    const paymentConfiguration = structuredClone(mapping);
    delete paymentConfiguration.invoiceLine.schemeCode;

    const payment = build({
      agreementValues: sharedCodeValues,
      paymentConfiguration,
    });

    expect(payment.payments[0].invoiceLines).toMatchObject([
      {
        schemeCode: "SHARED",
        description: "2026-11-06: Parcel: P1: Shared action",
      },
      {
        schemeCode: "SHARED",
        description:
          "2026-11-06: One-off payment per agreement per year for Shared action",
      },
    ]);
  });

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

  it("uses the definition-configured marketing year", () => {
    const payment = build();

    expect(payment.marketingYear).toBe("2026");
    expect(payment.payments[0].invoiceLines[0].marketingYear).toBe("2026");
  });

  it("reports a missing definition mapping as a server configuration error", () => {
    const error = getBuildError({ paymentConfiguration: undefined });

    expect(error.output.statusCode).toBe(500);
    expect(error.message).toBe(
      "createPayment requires payment configuration from the Agreement Definition",
    );
  });

  it("rejects an Agreement with no scheduled Instalments", () => {
    expect(() =>
      build({
        agreementValues: {
          ...agreementValues,
          paymentSchedule: { instalments: [] },
        },
      }),
    ).toThrow("Invalid Payment");
  });

  it("rejects a calculation whose total does not balance", () => {
    expect(() =>
      build({
        agreementValues: {
          ...agreementValues,
          totalAmountPence: 9999,
        },
      }),
    ).toThrow("totalAmountPence does not balance with its payments");
  });

  it("rejects a due payment that does not balance with its invoice lines", () => {
    expect(() =>
      build({
        agreementValues: {
          ...agreementValues,
          totalAmountPence: 9999,
          paymentSchedule: {
            instalments: [
              {
                ...agreementValues.paymentSchedule.instalments[0],
                totalAmountPence: 9999,
              },
            ],
          },
        },
      }),
    ).toThrow("does not balance with its invoice lines");
  });

  it.each([
    ["an empty description", { description: "" }, '"description"'],
    ["arbitrary metadata", { schemeCode: "PATCH" }, '"schemeCode"'],
  ])("rejects %s on scheduled Line Items", (_case, metadata, field) => {
    expect(() =>
      build({
        agreementValues: {
          ...agreementValues,
          paymentSchedule: {
            instalments: [
              {
                ...agreementValues.paymentSchedule.instalments[0],
                lineItems: [
                  {
                    actionId: "action:1",
                    amountPence: 2000,
                    ...metadata,
                  },
                  { actionId: "action:2", amountPence: 1800 },
                ],
              },
            ],
          },
        },
      }),
    ).toThrow(`Invalid Payment Schedule Line Item: ${field}`);
  });

  it("rejects a source with no identifiers", () => {
    expect(() => build({ sbi: undefined, frn: undefined })).toThrow(
      "Invalid Payment",
    );
  });

  it("requires the Agreement Correlation ID for grant-level correlation", () => {
    expect(() => build({ agreementCorrelationId: undefined })).toThrow(
      "Agreement Correlation ID",
    );
  });

  it("rejects a scheduled Line Item with no matching Agreement entry", () => {
    expect(() =>
      build({
        agreementValues: {
          ...agreementValues,
          paymentSchedule: {
            instalments: [
              {
                ...agreementValues.paymentSchedule.instalments[0],
                lineItems: [{ actionId: "action:missing", amountPence: 3800 }],
              },
            ],
          },
        },
      }),
    ).toThrow('unknown Agreement entry "action:missing"');
  });
});
