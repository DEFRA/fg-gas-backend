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

// The entitlement-creation view: the same application context, plus the one
// template being created against. It shows no submitted Claims, so it reads
// none - and stays clear of Payments entirely.
export const buildClaimView = async ({ creationDetails, ...overview }) => ({
  ...(await buildApplicationClaimsView(overview)),
  entitlementTemplate: toEntitlementTemplate(creationDetails),
});

// A Payment is raised asynchronously, and only once a claim needs no approval,
// so its absence means the payment is not scheduled - never that it failed.
export const toSubmittedClaim = (claim, claimPayments) => ({
  ...structuredClone(claim),
  paymentScheduled: claimPayments.has(claim.clientClaimRef),
});

// remainingCapacity is destructured only to keep it out of the view model.
const toAvailableEntitlement = ({ remainingCapacity: _ignored, ...option }) =>
  option;

export const toEntitlement = (entitlement) => structuredClone(entitlement);

export const toEntitlementTemplate = toAvailableEntitlement;
