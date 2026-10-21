// The banner arrives already resolved: reading references and refusing a grant
// with no banner are the BFF's work, not the view's.
const buildApplicationClaimsView = ({
  banner,
  creationOptions,
  claimableEntitlements,
  claimsRequiredRoles,
  access,
}) => ({
  banner,
  availableEntitlements: creationOptions.map(toAvailableEntitlement),
  claimableEntitlements: claimableEntitlements.map(toEntitlement),
  claimsRequiredRoles,
  access,
});

export const buildClaimsView = ({ claims, claimPayments, ...overview }) => ({
  ...buildApplicationClaimsView(overview),
  claims: claims.map((claim) => toSubmittedClaim(claim, claimPayments)),
});

// The entitlement-creation view: the same application context, plus the
// template being created against. It shows no submitted Claims, so it reads none.
export const buildClaimView = ({ creationDetails, ...overview }) => ({
  ...buildApplicationClaimsView(overview),
  entitlementTemplate: toEntitlementTemplate(creationDetails),
});

// The change-claimable-item view: the claims page, the entitlement being
// changed and the template it was made under.
export const buildEntitlementView = ({
  claimableEntitlement,
  entitlementTemplate,
  ...overview
}) => ({
  ...buildClaimsView(overview),
  claimableEntitlement: toEntitlement(claimableEntitlement),
  entitlementTemplate: toEntitlementTemplate(entitlementTemplate),
});

// No Payment means none has been raised, never that one failed.
export const toSubmittedClaim = (claim, claimPayments) => ({
  ...structuredClone(claim),
  paymentScheduled: claimPayments.has(claim.clientClaimRef),
});

// remainingCapacity is destructured only to keep it out of the view model.
const toAvailableEntitlement = ({ remainingCapacity: _ignored, ...option }) =>
  option;

export const toEntitlement = (entitlement) => structuredClone(entitlement);

export const toEntitlementTemplate = toAvailableEntitlement;
