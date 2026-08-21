import { logger } from "../../common/logger.js";
import { findExistingEntitlements } from "../../grants/repositories/entitlement.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "../../grants/use-cases/find-application-by-client-ref-and-code.use-case.js";
import { resolveCurrentGrantUseCase } from "../../grants/use-cases/resolve-current-grant.use-case.js";
import { buildBanner } from "../services/build-banner.js";

export const findClaimsUseCase = async ({ code, clientRef }) => {
  const application = await findApplicationByClientRefAndCodeUseCase(
    clientRef,
    code,
  );
  const currentConfigVersion = application.currentConfigVersion;

  logger.info({ currentConfigVersion }, "Application currentConfigVersion");

  const { grant } = await resolveCurrentGrantUseCase(
    code,
    currentConfigVersion,
  );

  logger.info(
    grant,
    `Grant for code ${code} and version ${currentConfigVersion}`,
  );

  // does the current application position meet the "availableAt" position on the entitlementTemplate?
  const position = application.currentPosition();

  const available = grant.findEntitlementTemplatesAvailableAt(position);

  // fetch created entitlements from the entitlements collection
  const existing = await findExistingEntitlements(clientRef, code);

  const countFor = (claimCode) =>
    existing.filter((entitlement) => entitlement.claimCode === claimCode)
      .length;

  // is materialised "false"
  // is the number of entitlement instances for this application less that the maxEntitlements field in the template?
  const availableEntitlements = available.filter(
    (template) =>
      template.materialised === false &&
      countFor(template.claimCode) < template.maxEntitlements,
  );

  logger.info(
    { available, existing: existing.length },
    `Entitlement templates available at position for ${clientRef}`,
  );

  // The header the claims page is topped with. Built here because this endpoint
  // serves that page: the admin frontend is handed values to render rather than
  // the pieces to assemble them from.
  return {
    banner: buildBanner({ grant, application }),
    availableEntitlements,
    claimableEntitlements: [],
    claims: [],
  };
};
