import { describe, expect, it } from "vitest";
import { ClaimableEntitlement } from "./claimable-entitlement.js";
import { EntitlementTemplate } from "./entitlement-template.js";
import { Entitlement } from "./entitlement.js";
import { Position } from "./position.js";

const position = {
  phase: "PRE_AWARD",
  stage: "ASSESSMENT",
  status: "APPLICATION_RECEIVED",
};
const current = new Position(position);

const template = EntitlementTemplate.fromDefinition({
  claimCode: "ENT_PA3",
  name: "PA3 entitlement",
  availableAt: [position],
  claim: {
    claimableAt: [position],
    limits: { maximumClaims: 2, allowsPartialClaims: false },
  },
});

describe("ClaimableEntitlement", () => {
  it("rejects a plain object given as a claimableAt entry", () => {
    expect(
      () =>
        new ClaimableEntitlement({
          claimCode: "ENT_PA3",
          claim: { claimableAt: [position] },
        }),
    ).toThrow(
      'Invalid claimable entitlement "ENT_PA3": "claim.claimableAt" must contain only PositionScopes',
    );
  });

  it("accepts a claim with PositionScopes and a claim with none", () => {
    expect(
      new ClaimableEntitlement({ claimCode: "ENT_PA3", claim: template.claim })
        .claim,
    ).toBe(template.claim);
    expect(
      new ClaimableEntitlement({ claimCode: "ENT_PA3" }).claim,
    ).toBeUndefined();
  });

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

    expect(claimable.canAcceptClaim(current, 1)).toEqual({ allowed: true });
  });

  it("rejects a claim outside its configured position", () => {
    const claimable = ClaimableEntitlement.fromMaterialised({
      template,
      code: "woodland",
      clientRef: "wmp-123",
    });

    expect(
      claimable.canAcceptClaim(
        new Position({ ...position, status: "IN_REVIEW" }),
        0,
      ),
    ).toEqual({ allowed: false, reason: "WRONG_POSITION" });
  });

  it("rejects a claim made without a position", () => {
    const claimable = ClaimableEntitlement.fromMaterialised({
      template,
      code: "woodland",
      clientRef: "wmp-123",
    });

    expect(claimable.canAcceptClaim(undefined, 0)).toEqual({
      allowed: false,
      reason: "WRONG_POSITION",
    });
  });

  it("rejects a claim when the template configures no claimable position", () => {
    const noClaimableAt = EntitlementTemplate.fromDefinition({
      claimCode: "ENT_PA3",
      name: "PA3 entitlement",
      availableAt: [position],
      claim: { limits: { maximumClaims: 2 } },
    });
    const claimable = ClaimableEntitlement.fromMaterialised({
      template: noClaimableAt,
      code: "woodland",
      clientRef: "wmp-123",
    });

    expect(claimable.canAcceptClaim(current, 0)).toEqual({
      allowed: false,
      reason: "WRONG_POSITION",
    });
  });

  it("allows a single claim when the template configures no limits", () => {
    const noLimits = EntitlementTemplate.fromDefinition({
      claimCode: "ENT_PA3",
      name: "PA3 entitlement",
      availableAt: [position],
      claim: { claimableAt: [position] },
    });
    const claimable = ClaimableEntitlement.fromMaterialised({
      template: noLimits,
      code: "woodland",
      clientRef: "wmp-123",
    });

    expect(claimable.maximumClaims).toBe(1);
    expect(claimable.canAcceptClaim(current, 0)).toEqual({ allowed: true });
    expect(claimable.canAcceptClaim(current, 1)).toEqual({
      allowed: false,
      reason: "MAXIMUM_CLAIMS_REACHED",
    });
  });

  it("rejects a claim when its limit is reached", () => {
    const claimable = ClaimableEntitlement.fromMaterialised({
      template,
      code: "woodland",
      clientRef: "wmp-123",
    });

    expect(claimable.canAcceptClaim(current, 2)).toEqual({
      allowed: false,
      reason: "MAXIMUM_CLAIMS_REACHED",
    });
  });

  it("reports whether a claim limit has remaining capacity", () => {
    const claimable = ClaimableEntitlement.fromMaterialised({
      template,
      code: "woodland",
      clientRef: "wmp-123",
    });

    expect(claimable.hasRemainingCapacity(1)).toBe(true);
    expect(claimable.hasRemainingCapacity(2)).toBe(false);
  });

  it("can be changed only until a claim is made against it", () => {
    const claimable = ClaimableEntitlement.fromMaterialised({
      template,
      code: "woodland",
      clientRef: "wmp-123",
    });

    expect(claimable.canBeChanged(0)).toBe(true);
    expect(claimable.canBeChanged(1)).toBe(false);
  });
});
