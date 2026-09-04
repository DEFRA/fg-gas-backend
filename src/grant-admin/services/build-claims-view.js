import { buildBanner } from "./build-banner.js";

export const buildClaimsView = async ({
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
    claims: [],
  };
};

// remainingCapacity is destructured only to keep it out of the view model.
const toAvailableEntitlement = ({ remainingCapacity: _ignored, ...option }) =>
  option;

export const toEntitlement = (entitlement) => structuredClone(entitlement);

export const toEntitlementTemplate = toAvailableEntitlement;
