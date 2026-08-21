import { describe, expect, it } from "vitest";
import { PaymentDefinition } from "./payment-definition.js";

const rawDefinition = {
  code: "woodland",
  scheme: "WMP",
  sourceSystem: "WMP",
  deliveryBody: "RP10",
  fesCode: "FALS_WMP",
  ledger: "AP",
  currency: "GBP",
  marketingYear: "jsonata:$substring($.execution.executedAt, 0, 4)",
  invoiceLine: {
    schemeCode: "PA3",
    description: "$.agreement.paymentDescription",
    accountCode: "SOS710",
    fundCode: "DRD10",
  },
};

const createDefinition = (overrides = {}) =>
  new PaymentDefinition(
    { ...rawDefinition, ...overrides },
    { code: "woodland", configVersion: "1.2.3" },
  );

describe("PaymentDefinition", () => {
  it("resolves configuration against execution and Agreement context", async () => {
    const definition = createDefinition();

    await expect(
      definition.resolve({
        execution: { executedAt: "2026-12-31T23:59:59.000Z" },
        agreement: {
          paymentDescription: "Woodland Management Plan Payment",
        },
      }),
    ).resolves.toEqual({
      scheme: "WMP",
      sourceSystem: "WMP",
      deliveryBody: "RP10",
      fesCode: "FALS_WMP",
      ledger: "AP",
      currency: "GBP",
      marketingYear: "2026",
      invoiceLine: {
        ...rawDefinition.invoiceLine,
        description: "Woodland Management Plan Payment",
      },
    });
  });

  it("rejects a definition published for another grant", () => {
    expect(() => createDefinition({ code: "other" })).toThrow(
      'code "other" does not match "woodland"',
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
    const definition = createDefinition({ scheme: "$.agreement.scheme" });

    await expect(
      definition.resolve({
        execution: { executedAt: "2026-12-31T23:59:59.000Z" },
        agreement: {
          scheme: 123,
          paymentDescription: "Woodland Management Plan Payment",
        },
      }),
    ).rejects.toThrow('"scheme" must be a string');
  });

  it("rejects an unresolved mapping", async () => {
    const definition = createDefinition();

    await expect(
      definition.resolve({
        execution: { executedAt: "2026-12-31T23:59:59.000Z" },
        agreement: {},
      }),
    ).rejects.toThrow(
      'Unresolved process mapping "$.agreement.paymentDescription"',
    );
  });
});
