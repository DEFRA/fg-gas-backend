import { buildBanner } from "./build-banner.js";

export const buildClaimsView = async ({
  grant,
  application,
  offerable,
  existing = [],
}) => {
  const banner = await buildBanner({ grant, application, page: "claims" });

  return {
    banner,
    availableEntitlements: offerable,
    claimableEntitlements: existing,
    claims: [],
  };
};
