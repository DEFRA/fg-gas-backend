import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { saveEvents } from "../../events/index.js";
import { UpdateCaseStatusCommand } from "../commands/update-case-status.command.js";
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

const enqueueCaseWorkingStatusUpdate = async (
  { application, move },
  session,
) => {
  const statusCommand = UpdateCaseStatusCommand.forPosition({
    caseRef: application.clientRef,
    workflowCode: application.code,
    configVersion: application.currentConfigVersion,
    position: move.new,
    previousPosition: move.previous,
  });

  await saveEvents(
    [
      {
        event: statusCommand,
        target: config.sns.updateCaseStatusTopicArn,
      },
    ],
    session,
  );
};

const publishCaseWorkingUpdateIfRequested = async (
  requested,
  transition,
  session,
) => {
  if (requested) {
    await enqueueCaseWorkingStatusUpdate(transition, session);
  }
};

const runTransitionProcesses = async (processes, context, session) => {
  for (const handler of getHandlersForAllProcesses(processes)) {
    await handler(context, session);
  }
};

export const transitionApplicationUseCase = async (
  {
    application,
    grant,
    targetPosition,
    sideEffectContext,
    publishCaseWorkingStatusUpdate = false,
  },
  session,
) => {
  const { clientRef, code, currentConfigVersion } = application;
  const move = application.moveTo(targetPosition, grant);

  if (!move.changed) {
    return;
  }

  await update(application, session);

  const publishStatusTransition = createStatusTransitionUpdateUseCase({
    clientRef,
    code,
    configVersion: currentConfigVersion,
    previousPosition: move.previous,
    currentPosition: move.new,
  });
  await publishStatusTransition(session);

  await publishCaseWorkingUpdateIfRequested(
    publishCaseWorkingStatusUpdate,
    { application, move },
    session,
  );

  await runTransitionProcesses(move.processes, sideEffectContext, session);
};
