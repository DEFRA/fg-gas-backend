import { logger } from "../../common/logger.js";
import { findExistingEntitlements } from "../repositories/entitlement.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";
import { resolveCurrentGrantUseCase } from "./resolve-current-grant.use-case.js";

export const findAvailableEntitlementTemplatesUseCase = async ({
  code,
  clientRef,
}) => {
  // get application - (extract version)
  const application = await findApplicationByClientRefAndCodeUseCase(
    clientRef,
    code,
  );
  const currentConfigVersion = application.currentConfigVersion;

  logger.info({ currentConfigVersion }, "Application currentConfigVersion");

  // get grant
  const { grant } = await resolveCurrentGrantUseCase(
    code,
    currentConfigVersion,
  );

  logger.info(
    grant,
    `Grant for code ${code} and version ${currentConfigVersion}`,
  );

  // look up entitlement templates from grant
  const { entitlementTemplates } = grant;

  // does the current application position meet the "availableAt" position on the entitlementTemplate?
  // is materialised "false"
  // is the number of entitlement instances for this application less that the maxEntitlements field in the template?
  //  ^ the above will have to be hardcoded. call out to a helper to fetch entitlement instances for an application

  const position = application.currentPosition();

  const available = grant.findEntitlementTemplatesAvailableAt(position);

  // fetch created entitlements from the entitlements collection
  const existing = await findExistingEntitlements(clientRef, code);

  const countFor = (claimCode) =>
    existing.filter((entitlement) => entitlement.claimCode === claimCode)
      .length;

  logger.info(
    { entitlementTemplates, available, existing: existing.length },
    `Entitlement templates available at position for ${clientRef}`,
  );

  return {
    entitlementTemplates: available.filter(
      (template) =>
        template.materialised === false &&
        countFor(template.claimCode) < template.maxEntitlements,
    ),
  };
};
