const quantityFor = (claim, template) => {
  const { quantity } = claim.claim ?? {};

  return typeof quantity === "number"
    ? { value: quantity, unit: template ? template.quantityUnit() : null }
    : null;
};

const nameFor = (template, claim) => template?.name ?? claim.claimCode;

const requiresApprovalFor = (template) =>
  Boolean(template?.claim?.requiresApproval);

const amountPenceFor = (claim) => claim.claim?.totalClaimAmountPence ?? null;

export const toSubmittedClaim = ({ claim, grant }) => {
  const template = grant.findEntitlementTemplate(claim.claimCode);

  return {
    clientClaimRef: claim.clientClaimRef,
    claimCode: claim.claimCode,
    name: nameFor(template, claim),
    quantity: quantityFor(claim, template),
    totalClaimAmountPence: amountPenceFor(claim),
    requiresApproval: requiresApprovalFor(template),
    submittedAt: claim.createdAt,
  };
};
