import { logger } from "../../common/logger.js";
import { update } from "../repositories/application.repository.js";
import { acceptAgreementUseCase } from "./accept-agreement.use-case.js";
import { addAgreementUseCase } from "./add-agreement.use-case.js";
import { applyAgreementTerminationUseCase } from "./apply-agreement-termination.use-case.js";
import { cancelAgreementUseCase } from "./cancel-agreement.use-case.js";
import { createAgreementCommandUseCase } from "./create-agreement-command.use-case.js";
import { createStatusTransitionUpdateUseCase } from "./create-status-transition-update.use-case.js";
import { requestAgreementCancellationUseCase } from "./request-agreement-cancellation.use-case.js";
import { requestAgreementTerminationUseCase } from "./request-agreement-termination.use-case.js";
import { withdrawAgreementUseCase } from "./withdraw-agreement.use-case.js";
import { withdrawApplicationUseCase } from "./withdraw-application.use-case.js";

const getHandlerForProcess = (processName) => {
  const processHandlers = {
    GENERATE_OFFER: createAgreementCommandUseCase,
    STORE_AGREEMENT_CASE: addAgreementUseCase,
    ACCEPT_AGREEMENT: acceptAgreementUseCase,
    CANCEL_AGREEMENT: cancelAgreementUseCase,
    REQUEST_APPLICATION_WITHDRAWAL: withdrawApplicationUseCase,
    REQUEST_AGREEMENT_CANCELLATION: requestAgreementCancellationUseCase,
    WITHDRAW_AGREEMENT: withdrawAgreementUseCase,
    REQUEST_AGREEMENT_TERMINATION: requestAgreementTerminationUseCase,
    APPLY_AGREEMENT_TERMINATION: applyAgreementTerminationUseCase,
  };

  return processHandlers[processName];
};

const getHandlersForAllProcesses = (processes) => {
  if (!processes) {
    return [];
  }

  if (typeof processes === "string") {
    logger.warn("processes is type string");
    return [];
  }

  return processes
    .map((processName) => getHandlerForProcess(processName))
    .filter((handler) => handler !== undefined);
};

export const transitionApplicationUseCase = async (
  { application, grant, targetPosition, sideEffectContext },
  session,
) => {
  const { clientRef, code, currentConfigVersion } = application;
  const move = application.moveTo(targetPosition, grant);

  if (move.changed) {
    await update(application, session);

    const publishStatusTransition = createStatusTransitionUpdateUseCase({
      clientRef,
      code,
      configVersion: currentConfigVersion,
      originalFullyQualifiedStatus: move.previous,
      newFullyQualifiedStatus: move.new,
    });
    await publishStatusTransition(session);

    for (const handler of getHandlersForAllProcesses(move.processes)) {
      await handler(sideEffectContext, session);
    }
  }

  return move;
};
