import { PositionDocument } from "./position-document.js";

const toPositionDocuments = (positions) =>
  positions.map((position) => new PositionDocument(position));

const toClaimDocument = (claim) =>
  claim?.claimableAt
    ? { ...claim, claimableAt: toPositionDocuments(claim.claimableAt) }
    : claim;

export class EntitlementTemplateDocument {
  constructor(template) {
    this.claimCode = template.claimCode;
    this.name = template.name;
    this.description = template.description;
    this.materialised = template.materialised;
    this.fields = template.fields;
    this.maxEntitlements = template.maxEntitlements;
    this.availableAt = toPositionDocuments(template.availableAt);
    this.help = template.help;
    this.claim = toClaimDocument(template.claim);
  }
}
