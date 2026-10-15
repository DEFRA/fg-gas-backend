import { EntitlementTemplateDocument } from "./entitlement-template-document.js";
import { PositionDocument } from "./position-document.js";
import { Position } from "./position.js";

const toPositionCode = (position) =>
  position instanceof Position ? position.toString() : position;

const toPositionCodes = (positions) =>
  Array.isArray(positions) ? positions.map(toPositionCode) : positions;

const toOnClaimApprovalDocument = (onClaimApproval) => ({
  ...onClaimApproval,
  currentPosition: new PositionDocument(onClaimApproval.currentPosition),
  targetPosition: new PositionDocument(onClaimApproval.targetPosition),
});

const toClaimsDocument = (claims) =>
  claims?.onClaimApproval
    ? {
        ...claims,
        onClaimApproval: toOnClaimApprovalDocument(claims.onClaimApproval),
      }
    : claims;

export class GrantDocument {
  constructor(grant) {
    this.code = grant.code;
    this.version = grant.version;
    this.metadata = grant.metadata;
    this.actions = grant.actions;
    this.phases = grant.phases;
    this.externalStatusMap = grant.externalStatusMap;
    this.amendablePositions = toPositionCodes(grant.amendablePositions);
    this.entitlementTemplates = grant.entitlementTemplates?.map(
      (template) => new EntitlementTemplateDocument(template),
    );
    this.pages = grant.pages;
    this.claims = toClaimsDocument(grant.claims);
    this.admin = grant.admin;
  }
}
