import { describe, expect, it } from "vitest";
import { Claim } from "./claim.js";

const props = {
  code: "woodland",
  clientRef: "wmp-6hb-j8e",
  claimCode: "ENT_CS_CAPITAL_PA3",
  clientClaimRef: "WMP-6HB-J8E-C0001",
  entitlementId: "5abb45b1-6679-4a5e-92f5-3d13d7b4b74e",
  metadata: { grantCode: "woodland", sbi: "113593357" },
  claim: { totalClaimAmountPence: 150000, unit: "ha" },
};

describe("Claim", () => {
  it("stamps both timestamps with the same submission time", () => {
    const claim = Claim.create(props);

    expect(claim.createdAt).toEqual(expect.any(String));
    expect(claim.updatedAt).toBe(claim.createdAt);
  });

  it("takes the supplied createdAt", () => {
    const claim = Claim.create({
      ...props,
      createdAt: "2026-09-10T17:29:55.456Z",
    });

    expect(claim.createdAt).toBe("2026-09-10T17:29:55.456Z");
    expect(claim.updatedAt).toBe("2026-09-10T17:29:55.456Z");
  });

  // The request schema is the only thing that constrains what a caller may put
  // in these bodies, so the Claim must not strip or reshape what it is given.
  it("keeps the submitted bodies as sent", () => {
    const submittedAt = new Date("2026-09-10T17:29:55.444Z");
    const claim = Claim.create({
      ...props,
      metadata: { ...props.metadata, submittedAt, nested: { deep: true } },
      claim: { ...props.claim, claimNumber: "WMP-6HB-J8E-C0001" },
    });

    expect(claim.metadata).toEqual({
      grantCode: "woodland",
      sbi: "113593357",
      submittedAt,
      nested: { deep: true },
    });
    expect(claim.claim).toEqual({
      totalClaimAmountPence: 150000,
      unit: "ha",
      claimNumber: "WMP-6HB-J8E-C0001",
    });
  });

  it("does not share the caller's bodies", () => {
    const metadata = { grantCode: "woodland" };
    const claim = Claim.create({ ...props, metadata });

    metadata.grantCode = "changed";

    expect(claim.metadata.grantCode).toBe("woodland");
  });

  it("is frozen all the way down", () => {
    const claim = Claim.create(props);

    expect(Object.isFrozen(claim)).toBe(true);
    expect(Object.isFrozen(claim.metadata)).toBe(true);
    expect(Object.isFrozen(claim.claim)).toBe(true);
  });

  it("reports every missing field at once", () => {
    expect(() => Claim.create({ code: "woodland" })).toThrow(
      /"clientRef" is required.*"entitlementId" is required/s,
    );
  });

  it("rejects a field it does not know", () => {
    expect(() => Claim.create({ ...props, paymentId: "payment-1" })).toThrow(
      '"paymentId" is not allowed',
    );
  });

  // The schema rejecting the field is one guard; the constructor assigning only
  // declared fields is the other. This asserts the second on its own, so a
  // schema loosened later cannot quietly put undeclared data on a Claim.
  it("copies nothing the schema does not declare, even if it stops rejecting it", () => {
    const strict = Claim.validationSchema;
    Claim.validationSchema = strict.unknown(true);

    try {
      const claim = Claim.create({ ...props, paymentId: "payment-1" });

      expect(claim.paymentId).toBeUndefined();
      expect(Object.keys(claim)).toEqual([
        "code",
        "clientRef",
        "claimCode",
        "clientClaimRef",
        "entitlementId",
        "metadata",
        "claim",
        "createdAt",
        "updatedAt",
      ]);
    } finally {
      Claim.validationSchema = strict;
    }
  });

  it("reports an invalid claim as a bad request", () => {
    expect(() => Claim.create({ code: "woodland" })).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 400 }),
      }),
    );
  });
});
