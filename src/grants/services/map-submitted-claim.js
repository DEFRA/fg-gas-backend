// A submitted Claim as the admin API answers it, resolved against the
// entitlement template it was made under.

// The submit schema keeps a quantity and its unit together, so one without the
// other never reaches here.
const quantityFor = (claim) => {
  const { totalEligibleArea, unit } = claim.claim ?? {};

  return unit === undefined ? null : { value: totalEligibleArea, unit };
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
    quantity: quantityFor(claim),
    totalClaimAmountPence: amountPenceFor(claim),
    requiresApproval: requiresApprovalFor(template),
    submittedAt: claim.createdAt,
  };
};
