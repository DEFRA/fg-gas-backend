import { describe, expect, it } from "vitest";
import { AgreementReference } from "./agreement-reference.js";

const values = {
  agreementNumber: "PMF823153883",
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
};

describe("AgreementReference", () => {
  it("is an immutable value object", () => {
    const reference = new AgreementReference(values);

    expect(reference).toEqual(values);
    expect(Object.isFrozen(reference)).toBe(true);
  });

  it("compares references by value", () => {
    const reference = new AgreementReference(values);

    expect(reference.equals(new AgreementReference(values))).toBe(true);
    expect(
      reference.equals(
        new AgreementReference({ ...values, clientRef: "another-client" }),
      ),
    ).toBe(false);
    expect(reference.equals(values)).toBe(false);
  });

  it.each(["agreementNumber", "code", "clientRef", "sbi"])(
    "requires a non-empty %s",
    (field) => {
      expect(() => new AgreementReference({ ...values, [field]: "" })).toThrow(
        `Agreement Reference ${field} must be a non-empty string`,
      );
    },
  );
});
