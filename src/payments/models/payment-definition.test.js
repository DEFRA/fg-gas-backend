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
  invoiceLine: {
    schemeCode: "PA3",
    description: "Woodland Management Plan Payment",
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
  it("resolves fixed policy and the UTC execution year", () => {
    const definition = createDefinition();

    expect(
      definition.resolve({ executedAt: "2026-12-31T23:59:59.000Z" }),
    ).toEqual({
      scheme: "WMP",
      sourceSystem: "WMP",
      deliveryBody: "RP10",
      fesCode: "FALS_WMP",
      ledger: "AP",
      currency: "GBP",
      marketingYear: "2026",
      invoiceLine: rawDefinition.invoiceLine,
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

  it("rejects an invalid execution date", () => {
    const definition = createDefinition();

    expect(() => definition.resolve({ executedAt: "not-a-date" })).toThrow(
      '"executedAt" must be an ISO date',
    );
  });
});
