import { logger } from "../../common/logger.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";
import {
  persistResolvedVersion,
  pinnedVersionOf,
  resolveCurrentGrantUseCase,
} from "./resolve-current-grant.use-case.js";

export const getApplicationStatusUseCase = async ({ code, clientRef }) => {
  logger.info(
    `Getting application status for application ${clientRef} with code ${code}`,
  );

  const application = await findApplicationByClientRefAndCodeUseCase(
    clientRef,
    code,
  );

  const {
    currentPhase: phase,
    currentStage: stage,
    currentStatus: status,
    originalConfigVersion,
  } = application;

  const { resolvedVersion } = await resolveCurrentGrantUseCase(
    code,
    pinnedVersionOf(application),
  );
  await persistResolvedVersion(application, resolvedVersion);

  logger.info(
    `Finished: Getting application status for application ${clientRef} with code ${code}`,
  );

  return {
    phase,
    stage,
    status,
    clientRef,
    grantCode: code,
    originalConfigVersion,
    currentConfigVersion: application.currentConfigVersion,
  };
};
