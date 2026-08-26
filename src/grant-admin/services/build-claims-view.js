import { buildBanner } from "./build-banner.js";

export const buildClaimsView = async ({
  grant,
  application,
  available,
  existing = [],
}) => {
  const banner = await buildBanner({ grant, application, page: "claims" });

  return {
    banner,
    availableEntitlements: available,
    claimableEntitlements: existing,
    claims: [],
  };
};
