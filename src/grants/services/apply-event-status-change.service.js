/**
 * APPLY EVENT STATUS CHANGE SERVICE
 *
 * This service handles external status change events (e.g., from Case Working system)
 * and applies them to grant applications. It:
 *
 * 1. Maps external status codes to internal application states
 * 2. Validates state transitions according to grant configuration
 * 3. Updates the application state
 * 4. Creates outbox records for side effects (events, commands)
 * 5. Persists changes atomically within a transaction
 *
 * The service uses the Outbox pattern to ensure reliable eventual consistency
 * when publishing events or triggering downstream processes.
 */

import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { findByCode } from "../repositories/grant.repository.js";
import { addAgreementUseCase } from "../use-cases/add-agreement.use-case.js";
import { createAgreementCommandUseCase } from "../use-cases/create-agreement-command.use-case.js";
import { createStatusTransitionUpdateUseCase } from "../use-cases/create-status-transition-update.use-case.js";
import { handleAgreementStatusChangeUseCase } from "../use-cases/handle-agreement-status-change.use-case.js";
import { withdrawAgreementUseCase } from "../use-cases/withdraw-agreement.use-case.js";

const getValidatedMapping = (grant, application, command) => {
  const mapping = grant.mapExternalStateToInternalState(
    application.currentPhase,
    application.currentStage,
    command.externalRequestedState,
    command.sourceSystem,
  );

  if (!mapping.valid) {
    return null;
  }

  return mapping;
};

const updateApplicationState = (
  application,
  validMapping,
  statusDefinition,
) => {
  application.currentPhase = validMapping.targetPhase;
  application.currentStage = validMapping.targetStage;
  application.currentStatus = validMapping.targetStatus;
  application.replacementAllowed = statusDefinition.replacementAllowed;
  application.updatedAt = new Date().toISOString();
};

const getHandlerForProcess = (processName) => {
  const processHandlers = {
    GENERATE_OFFER: createAgreementCommandUseCase,
    STORE_AGREEMENT_CASE: addAgreementUseCase,
    UPDATE_AGREEMENT_CASE: handleAgreementStatusChangeUseCase,
    WITHDRAW_OFFER: withdrawAgreementUseCase,
  };

  return processHandlers[processName];
};

/**
 * Attempt to map any additional actions (side-effects) that may need to be performed
 * on this state transition to a use-case which will be executed within the
 * withTransaction call.
 *
 * Returns an array of methods that can be called.
 */
export const getHandlersForAllProcesses = (processes) => {
  const handlers = [];
  if (!processes) {
    return handlers;
  }

  if (typeof processes === "string") {
    logger.warn("processes is type string");
    return handlers;
  }

  for (const processName of processes) {
    const handler = getHandlerForProcess(processName);
    handlers.push(handler);
  }
  return handlers.filter((h) => typeof h !== "undefined");
};

// ============================================================================
// STATE TRANSITION ORCHESTRATION
// ============================================================================

/**
 * Orchestrates the entire state transition process:
 * 1. Maps external status to internal state
 * 2. Validates the transition is allowed
 * 3. Updates the application state
 * 4. Creates side effects
 *
 * Returns null if the transition is invalid (no mapping or not allowed by grant rules).
 */
const processStateTransition = (application, grant, command) => {
  const originalFullyQualifiedStatus = application.getFullyQualifiedStatus();

  logger.info(`process state transition: ${originalFullyQualifiedStatus}`);

  const validMapping = getValidatedMapping(grant, application, command);

  if (!validMapping) {
    return null;
  }

  const transitionValidation = grant.isValidTransition(
    validMapping.targetPhase,
    validMapping.targetStage,
    validMapping.targetStatus,
    originalFullyQualifiedStatus,
  );

  if (!transitionValidation.valid) {
    logger.warn(
      `Invalid state transition: ${originalFullyQualifiedStatus} to ${validMapping.targetStatus}`,
    );
    return null;
  }

  updateApplicationState(
    application,
    validMapping,
    grant.findStatusDefinition(
      validMapping.targetPhase,
      validMapping.targetStage,
      validMapping.targetStatus,
    ),
  );

  const newFullyQualifiedStatus = application.getFullyQualifiedStatus();
  const { clientRef, code } = application;

  // Create a status update event for the transition
  const statusTransitionHandler = createStatusTransitionUpdateUseCase({
    clientRef,
    code,
    originalFullyQualifiedStatus,
    newFullyQualifiedStatus,
  });

  // Some transitions require additional logic (side-effects)
  // These are handled by external use-cases and run alongside the application update.
  const sideEffects = getHandlersForAllProcesses(
    transitionValidation.processes,
  );
  return { application, statusTransitionHandler, sideEffects };
};

const saveApplication = async (updatedApplication, session) => {
  await update(updatedApplication, session);
  return { application: updatedApplication };
};

/**
 * Main entry point for applying external status changes to grant applications.
 *
 * This function is typically called by SQS subscribers when external systems
 * (like Case Working) send status update messages. It handles the entire
 * state transition process within a database transaction.
 *
 * Flow:
 * 1. Looks up the application by clientRef
 * 2. Retrieves the grant configuration
 * 3. Processes the state transition (mapping, validation, state update)
 * 4. Saves application and runs any side-effects atomically
 */
export const applyExternalStateChange = async (command) => {
  // eslint-disable-next-line complexity
  return withTransaction(async (session) => {
    logger.info("applyExternalStateChange");

    const { clientRef, code } = command;
    const application = await findByClientRefAndCode({ clientRef, code });

    if (!application) {
      throw Boom.notFound(
        `Application with clientRef "${command.clientRef}" not found`,
      );
    }

    const grant = await findByCode(application.code);

    if (!grant) {
      throw Boom.notFound(`Grant with code "${application.code}" not found`);
    }

    const result = processStateTransition(application, grant, command);
    if (result) {
      const {
        application: updatedApplication,
        statusTransitionHandler,
        sideEffects,
      } = result;

      await saveApplication(updatedApplication, session);

      if (statusTransitionHandler) {
        await statusTransitionHandler(session);
      }
      if (sideEffects?.length > 0) {
        await Promise.all(
          sideEffects.map((handler) => handler(command, session)),
        );
      }
    } else {
      // must throw if we're to retry any inbox events
      throw new Error(
        `Unable to process state change from ${application.getFullyQualifiedStatus()} to ${command.externalRequestedState}`,
      );
    }
  });
};
