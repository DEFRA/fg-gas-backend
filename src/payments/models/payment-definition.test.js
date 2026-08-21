import { describe, expect, it } from "vitest";
import { PaymentDefinition } from "./payment-definition.js";

const rawDefinition = {
  code: "woodland",
  sbi: "$.agreement.identifiers.sbi",
  frn: "$.agreement.identifiers.frn",
  scheme: "WMP",
  sourceSystem: "WMP",
  deliveryBody: "RP10",
  fesCode: "FALS_WMP",
  originalInvoiceNumber: "",
  ledger: "AP",
  totalAmountPence: "$.agreement.amountPence",
  currency: "GBP",
  marketingYear: "jsonata:$substring($.execution.executedAt, 0, 4)",
  payments: [
    {
      dueDate: "$.agreement.paymentDate",
      totalAmountPence: "$.agreement.amountPence",
      invoiceLines: [
        {
          schemeCode: "PA3",
          description: "$.agreement.paymentDescription",
          amountPence: "$.agreement.amountPence",
          accountCode: "SOS710",
          fundCode: "DRD10",
          deliveryBody: "RP10",
          marketingYear: "jsonata:$substring($.execution.executedAt, 0, 4)",
        },
      ],
    },
  ],
};

const createDefinition = (overrides = {}) =>
  new PaymentDefinition(
    { ...rawDefinition, ...overrides },
    { code: "woodland", configVersion: "1.2.3" },
  );

const context = {
  execution: { executedAt: "2026-12-31T23:59:59.000Z" },
  agreement: {
    identifiers: { sbi: "106480734", frn: "1102285668" },
    amountPence: 158652,
    paymentDate: "2026-08-30",
    paymentDescription: "Woodland Management Plan Payment",
  },
};

describe("PaymentDefinition", () => {
  it("resolves every Payment business field from context", async () => {
    await expect(createDefinition().resolve(context)).resolves.toEqual({
      sbi: "106480734",
      frn: "1102285668",
      scheme: "WMP",
      sourceSystem: "WMP",
      deliveryBody: "RP10",
      fesCode: "FALS_WMP",
      originalInvoiceNumber: "",
      ledger: "AP",
      totalAmountPence: 158652,
      currency: "GBP",
      marketingYear: "2026",
      payments: [
        {
          dueDate: "2026-08-30",
          totalAmountPence: 158652,
          invoiceLines: [
            {
              schemeCode: "PA3",
              description: "Woodland Management Plan Payment",
              amountPence: 158652,
              accountCode: "SOS710",
              fundCode: "DRD10",
              deliveryBody: "RP10",
              marketingYear: "2026",
            },
          ],
        },
      ],
    });
  });

  it("rejects a definition published for another grant", () => {
    expect(() => createDefinition({ code: "other" })).toThrow(
      'code "other" does not match "woodland"',
    );
  });

  it("rejects platform-owned fields", () => {
    expect(() => createDefinition({ paymentRequestNumber: 2 })).toThrow(
      '"paymentRequestNumber" is not allowed',
    );
  });

  it("rejects platform-owned configVersion", () => {
    expect(() => createDefinition({ configVersion: "1.2.3" })).toThrow(
      '"configVersion" is not allowed',
    );
  });

  it("rejects an invalid mapping expression", () => {
    expect(() =>
      createDefinition({ marketingYear: "jsonata:$substring(" }),
    ).toThrow("Invalid Payment definition");
  });

  it("rejects a resolved value with the wrong type", async () => {
    const definition = createDefinition({ scheme: "$.agreement.amountPence" });

    await expect(definition.resolve(context)).rejects.toThrow(
      '"scheme" must be a string',
    );
  });

  it("rejects an unresolved mapping", async () => {
    const definition = createDefinition({ sbi: "$.agreement.missing" });

    await expect(definition.resolve(context)).rejects.toThrow(
      'Unresolved process mapping "$.agreement.missing"',
    );
  });
});
