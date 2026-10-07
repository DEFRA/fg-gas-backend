import { buildBanner } from "./build-banner.js";

const buildApplicationClaimsView = async ({
  claimsPage,
  applicationContext,
  creationOptions,
  claimableEntitlements,
}) => {
  const banner = await buildBanner({ claimsPage, applicationContext });

  return {
    banner,
    availableEntitlements: creationOptions.map(toAvailableEntitlement),
    claimableEntitlements: claimableEntitlements.map(toEntitlement),
  };
};

export const buildClaimsView = async ({
  claims,
  claimPayments,
  ...overview
}) => ({
  ...(await buildApplicationClaimsView(overview)),
  claims: claims.map((claim) => toSubmittedClaim(claim, claimPayments)),
});

// The entitlement-creation view: the same application context, plus the
// template being created against. It shows no submitted Claims, so it reads none.
export const buildClaimView = async ({ creationDetails, ...overview }) => ({
  ...(await buildApplicationClaimsView(overview)),
  entitlementTemplate: toEntitlementTemplate(creationDetails),
});

// The change-claimable-item view: the claims page, the entitlement being
// changed and the template it was made under.
export const buildEntitlementView = async ({
  claimableEntitlement,
  entitlementTemplate,
  ...overview
}) => ({
  ...(await buildClaimsView(overview)),
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
