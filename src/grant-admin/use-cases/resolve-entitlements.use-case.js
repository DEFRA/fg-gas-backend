import { logger } from "../../common/logger.js";
import { findExistingEntitlements } from "../../grants/repositories/entitlement.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "../../grants/use-cases/find-application-by-client-ref-and-code.use-case.js";
import { resolveCurrentGrantUseCase } from "../../grants/use-cases/resolve-current-grant.use-case.js";

const selectOfferable = (atPosition) =>
  atPosition.filter((template) => template.materialised === false);

// Each available template carries how many entitlements already exist against
// it, so a caller can show "1 of 3" without a way to count for itself.
const selectAvailable = (offerable, existing) => {
  const countFor = (claimCode) =>
    existing.filter((entitlement) => entitlement.claimCode === claimCode)
      .length;

  return offerable
    .filter(
      (template) => countFor(template.claimCode) < template.maxEntitlements,
    )
    .map((template) => ({
      ...template,
      createdCount: countFor(template.claimCode),
    }));
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

  const offerable = selectOfferable(
    grant.findEntitlementTemplatesAvailableAt(application.currentPosition()),
  );

  const existing = await findExistingEntitlements(clientRef, code);

  const available = selectAvailable(offerable, existing);

  logger.info(
    {
      offerable: offerable.length,
      available: available.length,
      existing: existing.length,
    },
    `Entitlement templates resolved for ${clientRef}`,
  );

  return { application, grant, offerable, available, existing };
};
