import { describe, expect, it } from "vitest";
import { AgreementReference } from "./agreement-reference.js";
import { AgreementVersion } from "./agreement-version.js";
import { Agreement } from "./agreement.js";

const reference = new AgreementReference({
  agreementNumber: "PMF823153883",
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
});

const snapshot = {
  agreementNumber: reference.agreementNumber,
  code: reference.code,
  identifiers: { sbi: reference.sbi },
  items: [
    {
      agreementCode: reference.code,
      clientRef: reference.clientRef,
      identifiers: { sbi: reference.sbi },
    },
  ],
};

describe("AgreementVersion", () => {
  it("normalizes a plain snapshot into an Agreement", () => {
    const actionExecution = {
      name: "accept",
      agreementItemId: "29b829c4-4e38-405c-9f00-427ee94120a5",
      idempotencyKey: "9ea924aa-45e9-43a7-888e-c25054ea658c",
    };
    const version = AgreementVersion.new({
      agreementId: "agreement-id",
      agreementNumber: reference.agreementNumber,
      version: 1,
      snapshot,
      actionExecution,
    });

    expect(version.snapshot).toBeInstanceOf(Agreement);
    expect(version.snapshot.findItem(reference)).toEqual(snapshot.items[0]);
    expect(version.actionExecution).toEqual(actionExecution);
  });
});
