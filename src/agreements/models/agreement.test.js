import { describe, expect, it } from "vitest";
import { AgreementReference } from "./agreement-reference.js";
import { Agreement } from "./agreement.js";

const referenceValues = {
  agreementNumber: "PMF823153883",
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
};

const query = {
  code: referenceValues.code,
  clientRef: referenceValues.clientRef,
  sbi: referenceValues.sbi,
};

const item = {
  agreementCode: referenceValues.code,
  clientRef: referenceValues.clientRef,
};

const toAgreement = (override = {}) =>
  new Agreement({
    agreementNumber: referenceValues.agreementNumber,
    code: referenceValues.code,
    identifiers: { sbi: referenceValues.sbi },
    items: [item],
    ...override,
  });

const toReference = (override = {}) =>
  new AgreementReference({ ...referenceValues, ...override });

describe("Agreement.resolveReference", () => {
  it("resolves a complete reference for a matching Agreement and item", () => {
    expect(toAgreement().resolveReference(query)).toEqual(toReference());
  });

  it.each([
    ["code", { code: "another-code" }],
    ["SBI", { identifiers: { sbi: "999999999" } }],
    ["client reference", { items: [{ ...item, clientRef: "other" }] }],
    ["missing items", { items: undefined }],
  ])("returns undefined for a mismatched %s", (_name, override) => {
    expect(toAgreement(override).resolveReference(query)).toBeUndefined();
  });
});

describe("Agreement.findItem", () => {
  it("returns the item matching an Agreement Reference", () => {
    expect(toAgreement().findItem(toReference())).toBe(item);
  });

  it.each([
    ["agreement number", { agreementNumber: "PMF000000000" }],
    ["code", { code: "another-code" }],
    ["SBI", { sbi: "999999999" }],
    ["client reference", { clientRef: "other" }],
  ])("returns undefined for a mismatched %s", (_name, override) => {
    expect(toAgreement().findItem(toReference(override))).toBeUndefined();
  });

  it("requires an Agreement Reference", () => {
    expect(() => toAgreement().findItem(referenceValues)).toThrow(
      "Agreement item lookup requires an Agreement Reference",
    );
  });
});
