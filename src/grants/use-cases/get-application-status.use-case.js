import { logger } from "../../common/logger.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";

export const getApplicationStatusUseCase = async ({ code, clientRef }) => {
  logger.info(
    `Getting application status for application ${clientRef} with code ${code}`,
  );

  const {
    currentPhase: phase,
    currentStage: stage,
    currentStatus: status,
  } = await findApplicationByClientRefAndCodeUseCase(clientRef, code);

  logger.info(
    `Finished: Getting application status for application ${clientRef} with code ${code}`,
  );

  return {
    phase,
    stage,
    status,
    clientRef,
    grantCode: code,
  };
};
