import { buildBanner } from "./build-banner.js";

export const buildClaimsView = async ({
  claimsPage,
  applicationContext,
  creationOptions,
  entitlements,
}) => {
  const banner = await buildBanner({ claimsPage, applicationContext });

  return {
    banner,
    availableEntitlements: creationOptions.map(toAvailableEntitlement),
    claimableEntitlements: entitlements.map(toEntitlement),
    claims: [],
  };
};

const toAvailableEntitlement = ({ remainingCapacity, ...option }) => option;

export const toEntitlement = (entitlement) => structuredClone(entitlement);

export const toEntitlementTemplate = toAvailableEntitlement;
