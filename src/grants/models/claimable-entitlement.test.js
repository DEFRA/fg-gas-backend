import { describe, expect, it } from "vitest";
import { ClaimableEntitlement } from "./claimable-entitlement.js";
import { EntitlementTemplate } from "./entitlement-template.js";
import { Entitlement } from "./entitlement.js";

const position = {
  phase: "PRE_AWARD",
  stage: "ASSESSMENT",
  status: "APPLICATION_RECEIVED",
};

const template = new EntitlementTemplate({
  claimCode: "ENT_PA3",
  name: "PA3 entitlement",
  availableAt: [position],
  claim: {
    claimableAt: [position],
    limits: { maximumClaims: 2, allowsPartialClaims: false },
  },
});

describe("ClaimableEntitlement", () => {
  it("builds a materialised claim target", () => {
    const claimable = ClaimableEntitlement.fromMaterialised({
      template,
      code: "woodland",
      clientRef: "wmp-123",
    });

    expect(claimable.type).toBe("materialised");
    expect(claimable.claimCode).toBe("ENT_PA3");
    expect(claimable.key()).toBe("woodland:wmp-123:ENT_PA3");
  });

  it("builds a persisted claim target", () => {
    const entitlement = Entitlement.create({
      id: "entitlement-1",
      clientRef: "wmp-123",
      code: "woodland",
      claimCode: "ENT_PA3",
      instanceNumber: 1,
      configVersion: "1.0.0",
      data: { hectares: 10 },
    });

    const claimable = ClaimableEntitlement.fromPersisted({
      entitlement,
      template,
    });

    expect(claimable.type).toBe("persisted");
    expect(claimable.entitlement).toBe(entitlement);
    expect(claimable.key()).toBe("woodland:wmp-123:ENT_PA3");
  });

  it("accepts a claim within its position and limit", () => {
    const claimable = ClaimableEntitlement.fromMaterialised({
      template,
      code: "woodland",
      clientRef: "wmp-123",
    });

    expect(claimable.canAcceptClaim(position, 1)).toEqual({ allowed: true });
  });

  it("rejects a claim outside its configured position", () => {
    const claimable = ClaimableEntitlement.fromMaterialised({
      template,
      code: "woodland",
      clientRef: "wmp-123",
    });

    expect(
      claimable.canAcceptClaim({ ...position, status: "IN_REVIEW" }, 0),
    ).toEqual({ allowed: false, reason: "WRONG_POSITION" });
  });

  it("rejects a claim when its limit is reached", () => {
    const claimable = ClaimableEntitlement.fromMaterialised({
      template,
      code: "woodland",
      clientRef: "wmp-123",
    });

    expect(claimable.canAcceptClaim(position, 2)).toEqual({
      allowed: false,
      reason: "MAXIMUM_CLAIMS_REACHED",
    });
  });
});
