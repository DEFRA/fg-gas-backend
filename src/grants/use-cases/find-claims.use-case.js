import { logger } from "../../common/logger.js";
import { findExistingEntitlements } from "../repositories/entitlement.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";
import { resolveCurrentGrantUseCase } from "./resolve-current-grant.use-case.js";

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

  return {
    availableEntitlements,
    claimableEntitlements: [],
    claims: [],
  };
};
