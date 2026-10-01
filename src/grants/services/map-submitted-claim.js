// A submitted Claim as the admin API answers it, resolved against the
// entitlement template it was made under.

// Claims stored before the submit schema paired a quantity with its unit may
// carry either half alone, and half a measurement is no measurement.
const quantityFor = (claim) => {
  const { totalEligibleArea, unit } = claim.claim ?? {};

  return typeof totalEligibleArea === "number" && typeof unit === "string"
    ? { value: totalEligibleArea, unit }
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
    quantity: quantityFor(claim),
    totalClaimAmountPence: amountPenceFor(claim),
    requiresApproval: requiresApprovalFor(template),
    submittedAt: claim.createdAt,
  };
};
