import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";

export const getApplicationStatusUseCase = async ({ code, clientRef }) => {
  const {
    currentPhase: phase,
    currentStage: stage,
    currentStatus: status,
  } = await findApplicationByClientRefAndCodeUseCase(clientRef, code);

  return {
    phase,
    stage,
    status,
    clientRef,
    grantCode: code,
  };
};
