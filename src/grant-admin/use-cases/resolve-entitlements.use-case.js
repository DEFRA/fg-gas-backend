import { logger } from "../../common/logger.js";
import { findExistingEntitlements } from "../../grants/repositories/entitlement.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "../../grants/use-cases/find-application-by-client-ref-and-code.use-case.js";
import { resolveCurrentGrantUseCase } from "../../grants/use-cases/resolve-current-grant.use-case.js";

const selectAvailable = (atPosition, existing) => {
  const countFor = (claimCode) =>
    existing.filter((entitlement) => entitlement.claimCode === claimCode)
      .length;

  return atPosition.filter(
    (template) =>
      template.materialised === false &&
      countFor(template.claimCode) < template.maxEntitlements,
  );
};

export const resolveEntitlementsUseCase = async ({ code, clientRef }) => {
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

  const atPosition = grant.findEntitlementTemplatesAvailableAt(
    application.currentPosition(),
  );

  const existing = await findExistingEntitlements(clientRef, code);

  const available = selectAvailable(atPosition, existing);

  logger.info(
    {
      atPosition: atPosition.length,
      available: available.length,
      existing: existing.length,
    },
    `Entitlement templates resolved for ${clientRef}`,
  );

  return { application, grant, atPosition, available, existing };
};
