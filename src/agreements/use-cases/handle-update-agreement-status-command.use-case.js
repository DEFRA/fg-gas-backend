import { logger } from "../../common/logger.js";
import { InvalidAgreementTransitionError } from "../models/invalid-agreement-transition.error.js";
import { findVersionByIdempotencyKey } from "../repositories/agreement.repository.js";
import { recordAgreementActionFailure } from "../services/agreement-audit.js";
import {
  commitAgreementAction,
  isAgreementActionConcurrencyLoss,
} from "./execute-agreement-action.use-case.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";

const findCompleted = async ({ agreementNumber, status }, idempotencyKey) => {
  const version = await findVersionByIdempotencyKey(
    agreementNumber,
    idempotencyKey,
  );

  if (!version) {
    return null;
  }
  if (version.snapshot.state !== status) {
    logger.error(
      `Agreement status command ${idempotencyKey} was already used for state ${version.snapshot.state}`,
    );
    return version.snapshot;
  }
  return version.snapshot;
};

const executeStatusTransition = async ({
  command,
  agreement,
  definition,
  attempt,
}) => {
  const { status } = command.data;
  const actionName = definition.resolveActionForStatus({
    state: agreement.state,
    status,
  }).transition.action;
  attempt.actionName = actionName;
  const execution = {
    correlationId: agreement.correlationId,
    executedAt: new Date().toISOString(),
  };
  const next = await definition.executeAction({
    agreement,
    actionName,
    values: {},
    execution,
  });
  return commitAgreementAction({
    actionName,
    current: agreement,
    idempotencyKey: command.id,
    next,
  });
};

const preconditionFailedStatusCode = 412;

const isRejectedTransition = (error) =>
  error instanceof InvalidAgreementTransitionError ||
  (error.isBoom && error.output.statusCode === preconditionFailedStatusCode);

const reportRejectedTransition = (error, command, agreement) => {
  if (!isRejectedTransition(error)) {
    throw error;
  }

  logger.warn(
    error,
    `Rejected Agreement status ${command.data.status} for ${agreement.agreementNumber} in state ${agreement.state}`,
  );
};

export const handleUpdateAgreementStatusCommandUseCase = async (command) => {
  const completed = await findCompleted(command.data, command.id);
  if (completed) {
    return completed;
  }

  const { agreement, agreementDefinition } = await loadCurrentAgreementContext({
    agreementNumber: command.data.agreementNumber,
  });

  const attempt = {
    actionName: command.data.status,
    state: command.data.status,
  };
  try {
    return await executeStatusTransition({
      command,
      agreement,
      definition: agreementDefinition,
      attempt,
    });
  } catch (error) {
    if (!isAgreementActionConcurrencyLoss(error)) {
      await recordAgreementActionFailure({
        actionName: attempt.actionName,
        current: agreement,
        attempted: { state: attempt.state },
        error,
        idempotencyKey: command.id,
      });
    }
    return reportRejectedTransition(error, command, agreement);
  }
};
