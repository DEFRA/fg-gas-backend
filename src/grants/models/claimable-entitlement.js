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

    if (count >= this.maximumClaims) {
      return { allowed: false, reason: "MAXIMUM_CLAIMS_REACHED" };
    }

    return { allowed: true };
  }

  get maximumClaims() {
    return this.claim?.limits?.maximumClaims ?? 1;
  }

  #isClaimableAt(position) {
    if (!position) {
      return false;
    }

    return (this.claim?.claimableAt ?? []).some((declared) => {
      const matches = (declaredPart, actualPart) =>
        declaredPart == null || declaredPart === actualPart;

      return (
        declared.phase === position.phase &&
        matches(declared.stage, position.stage) &&
        matches(declared.status, position.status)
      );
    });
  }
}
