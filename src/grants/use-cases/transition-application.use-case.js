import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { saveEvents } from "../../events/index.js";
import { UpdateCaseStatusCommand } from "../commands/update-case-status.command.js";
import { ApplicationStatus } from "../models/application.js";
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

const grantProcess = (handle, effects) => ({
  handle,
  setsStatus: null,
  tellsCw: false,
  onlyWhen: null,
  ...effects,
});

// What each process does beyond the move: a status it sets itself, and
// whether it tells CW the application's status.
const grantProcesses = {
  GENERATE_OFFER: grantProcess(createAgreementCommandUseCase),
  STORE_AGREEMENT_CASE: grantProcess(addAgreementUseCase, { tellsCw: true }),
  ACCEPT_AGREEMENT: grantProcess(acceptAgreementUseCase, { tellsCw: true }),
  CANCEL_AGREEMENT: grantProcess(cancelAgreementUseCase, { tellsCw: true }),
  REQUEST_APPLICATION_WITHDRAWAL: grantProcess(withdrawApplicationUseCase, {
    setsStatus: ApplicationStatus.Withdrawn,
    tellsCw: true,
    onlyWhen: "no agreement is on offer",
  }),
  REQUEST_AGREEMENT_CANCELLATION: grantProcess(
    requestAgreementCancellationUseCase,
  ),
  WITHDRAW_AGREEMENT: grantProcess(withdrawAgreementUseCase, {
    tellsCw: true,
  }),
  REQUEST_AGREEMENT_TERMINATION: grantProcess(
    requestAgreementTerminationUseCase,
  ),
  APPLY_AGREEMENT_TERMINATION: grantProcess(applyAgreementTerminationUseCase, {
    tellsCw: true,
  }),
};

// A process with no handler is skipped when a transition runs.
export const isGrantProcess = (processName) =>
  Object.hasOwn(grantProcesses, processName);

// Null for a process with no handler, which does nothing.
export const processEffectsOf = (processName) => {
  if (!isGrantProcess(processName)) {
    return null;
  }

  const { setsStatus, tellsCw, onlyWhen } = grantProcesses[processName];

  return { process: processName, setsStatus, tellsCw, onlyWhen };
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
    .filter(isGrantProcess)
    .map((processName) => grantProcesses[processName].handle);
};

const enqueueCaseWorkingStatusUpdate = async (
  { application, previousPosition, newStatus },
  session,
) => {
  const statusCommand = new UpdateCaseStatusCommand({
    caseRef: application.clientRef,
    workflowCode: application.code,
    configVersion: application.currentConfigVersion,
    newStatus,
    phase: previousPosition.phase,
    stage: previousPosition.stage,
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
  const previousPosition = application.currentPosition();
  const move = application.moveTo(targetPosition, grant);

  if (!move.changed) {
    return;
  }

  await update(application, session);

  const publishStatusTransition = createStatusTransitionUpdateUseCase({
    clientRef,
    code,
    configVersion: currentConfigVersion,
    originalFullyQualifiedStatus: move.previous,
    newFullyQualifiedStatus: move.new,
  });
  await publishStatusTransition(session);

  await publishCaseWorkingUpdateIfRequested(
    publishCaseWorkingStatusUpdate,
    { application, previousPosition, newStatus: move.new },
    session,
  );

  await runTransitionProcesses(move.processes, sideEffectContext, session);
};
