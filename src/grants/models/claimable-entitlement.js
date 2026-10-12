import Boom from "@hapi/boom";
import { PositionScope } from "./position-scope.js";

export class ClaimableEntitlement {
  constructor({
    type,
    code,
    clientRef,
    claimCode,
    name,
    description,
    fields,
    claim,
    entitlement,
  }) {
    this.type = type;
    this.code = code;
    this.clientRef = clientRef;
    this.claimCode = claimCode;
    this.name = name;
    this.description = description;
    this.fields = fields;
    this.claim = claim;
    this.entitlement = entitlement;

    if (!PositionScope.areAll(claim?.claimableAt)) {
      throw Boom.badImplementation(
        `Invalid claimable entitlement "${claimCode}": "claim.claimableAt" must contain only PositionScopes`,
      );
    }
  }

  static fromMaterialised({ template, code, clientRef }) {
    return new ClaimableEntitlement({
      type: "materialised",
      code,
      clientRef,
      claimCode: template.claimCode,
      name: template.name,
      description: template.description,
      fields: template.fields,
      claim: template.claim,
    });
  }

  static fromPersisted({ entitlement, template }) {
    return new ClaimableEntitlement({
      type: "persisted",
      code: entitlement.code,
      clientRef: entitlement.clientRef,
      claimCode: entitlement.claimCode,
      name: template.name,
      description: template.description,
      fields: template.fields,
      claim: template.claim,
      entitlement,
    });
  }

  key() {
    return `${this.code}:${this.clientRef}:${this.claimCode}`;
  }

  canAcceptClaim(position, count) {
    if (!this.#isClaimableAt(position)) {
      return { allowed: false, reason: "WRONG_POSITION" };
    }

    if (!this.hasRemainingCapacity(count)) {
      return { allowed: false, reason: "MAXIMUM_CLAIMS_REACHED" };
    }

    return { allowed: true };
  }

  canBeChanged(count) {
    return count === 0;
  }

  hasRemainingCapacity(count) {
    return count < this.maximumClaims;
  }

  get maximumClaims() {
    return this.claim?.limits?.maximumClaims ?? 1;
  }

  #isClaimableAt(position) {
    return PositionScope.anyCovers(this.claim?.claimableAt ?? [], position);
  }
}
