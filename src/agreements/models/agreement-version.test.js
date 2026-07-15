import { describe, expect, it } from "vitest";
import { AgreementVersion } from "./agreement-version.js";
import { Agreement } from "./agreement.js";

const identity = {
  agreementNumber: "PMF823153883",
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
};

const snapshot = {
  agreementNumber: identity.agreementNumber,
  code: identity.code,
  identifiers: { sbi: identity.sbi },
  items: [
    {
      agreementCode: identity.code,
      clientRef: identity.clientRef,
    },
  ],
};

describe("AgreementVersion", () => {
  it("normalizes a plain snapshot into an Agreement", () => {
    const version = AgreementVersion.new({
      agreementId: "agreement-id",
      agreementNumber: identity.agreementNumber,
      version: 1,
      snapshot,
    });

    expect(version.snapshot).toBeInstanceOf(Agreement);
    expect(version.snapshot.findItemForIdentity(identity)).toEqual(
      snapshot.items[0],
    );
  });
});
