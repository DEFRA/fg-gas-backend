import { buildBanner } from "./build-banner.js";

export const buildClaimsView = async ({
  claimsPage,
  applicationContext,
  creationOptions,
  claimableEntitlements,
  claims,
  claimPayments,
}) => {
  const banner = await buildBanner({ claimsPage, applicationContext });

  return {
    banner,
    availableEntitlements: creationOptions.map(toAvailableEntitlement),
    claimableEntitlements: claimableEntitlements.map(toEntitlement),
    claims: claims.map((claim) => toSubmittedClaim(claim, claimPayments)),
  };
};

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
