import { describe, expect, it } from "vitest";
import { Agreement } from "./agreement.js";

const identity = {
  agreementNumber: "PMF823153883",
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
};

const item = {
  agreementCode: identity.code,
  clientRef: identity.clientRef,
};

const toAgreement = (override = {}) =>
  new Agreement({
    agreementNumber: identity.agreementNumber,
    code: identity.code,
    identifiers: { sbi: identity.sbi },
    items: [item],
    ...override,
  });

describe("Agreement.findItemForIdentity", () => {
  it("returns the item matching the complete Agreement Identity", () => {
    expect(toAgreement().findItemForIdentity(identity)).toBe(item);
  });

  it.each([
    ["agreement number", { agreementNumber: "PMF000000000" }],
    ["code", { code: "another-code" }],
    ["SBI", { identifiers: { sbi: "999999999" } }],
    ["client reference", { items: [{ ...item, clientRef: "other" }] }],
    ["missing items", { items: undefined }],
  ])("returns undefined for a mismatched %s", (_name, override) => {
    expect(toAgreement(override).findItemForIdentity(identity)).toBeUndefined();
  });
});
