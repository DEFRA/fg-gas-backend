import { describe, expect, it } from "vitest";
import { Claim } from "../../models/claim.js";
import { submitClaimRequestSchema } from "./submit-claim-request.schema.js";

const payload = {
  metadata: {
    grantCode: "woodland",
    clientRef: "wmp-6hb-j8e",
    clientClaimRef: "WMP-6HB-J8E-C0001",
    configVersion: "1.14.0",
    sbi: "113593357",
    crn: "1100943757",
    frn: "1100943757",
  },
  claim: {
    entitlementId: "entitlement-1",
    totalClaimAmountPence: 150000,
    quantity: 23,
    grantSpecificField: "retained",
  },
};

const createClaim = (claim) =>
  Claim.create({
    code: payload.metadata.grantCode,
    clientRef: payload.metadata.clientRef,
    claimCode: "ENT_CS_CAPITAL_PA3",
    clientClaimRef: payload.metadata.clientClaimRef,
    metadata: payload.metadata,
    claim,
  });

describe("shared claim body validation", () => {
  it.each([
    ["entitlementId", undefined],
    ["entitlementId", 123],
    ["totalClaimAmountPence", undefined],
    ["totalClaimAmountPence", -1],
    ["totalClaimAmountPence", "invalid"],
    ["totalClaimAmountPence", 1.5],
    ["quantity", -1],
    ["quantity", "invalid"],
  ])("rejects %s = %s through both entry points", (field, value) => {
    const claim = { ...payload.claim, [field]: value };

    const { error } = submitClaimRequestSchema.validate({ ...payload, claim });

    expect(error.details[0].path).toEqual(["claim", field]);
    expect(() => createClaim(claim)).toThrow();
  });

  it.each([undefined, 0, 1.5])(
    "accepts quantity %s and retains grant-specific fields through both entry points",
    (quantity) => {
      const claim = { ...payload.claim, totalClaimAmountPence: 0, quantity };
      const result = submitClaimRequestSchema.validate({ ...payload, claim });

      expect(result.error).toBeUndefined();
      expect(result.value.claim).toEqual(claim);
      expect(createClaim(claim).claim).toEqual(claim);
    },
  );

  it("requires the claim body through both entry points", () => {
    expect(
      submitClaimRequestSchema.validate({ metadata: payload.metadata }).error,
    ).toBeDefined();
    expect(() => createClaim(undefined)).toThrow();
  });
});
