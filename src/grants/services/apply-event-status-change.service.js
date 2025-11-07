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

const updateApplicationState = (application, validMapping) => {
  application.currentPhase = validMapping.targetPhase;
  application.currentStage = validMapping.targetStage;
  application.currentStatus = validMapping.targetStatus;
  application.updatedAt = new Date().toISOString();
};

const getHandlerForProcess = (processName) => {
  const processHandlers = {
    GENERATE_AGREEMENT: createAgreementCommandUseCase,
    STORE_AGREEMENT_CASE: addAgreementUseCase,
  };

  return processHandlers[processName];
};

/**
 * Attempt to map any additional actions (side-effects) that may need to be performed
 * on this state transition to a use-case which will be exectuted within the
 * withTransaction call.
 *
 * Returns an array of methods that can be called.
 */
// eslint-disable-next-line complexity
const getHandlersForAllEntryProcesses = (transitionValidation) => {
  if (!transitionValidation.entryProcesses) {
    return [];
  }

  const handlers = [];

  // sometimes the entryProcess is just a string, not an array
  if (typeof transitionValidation.entryProcesses === "string") {
    const handler = getHandlerForProcess(transitionValidation.entryProcesses);
    handler && handlers.push(handler);
  } else {
    for (const processName of transitionValidation.entryProcesses) {
      const handler = getHandlerForProcess(processName);
      handler && handlers.push(handler);
    }
  }
  return handlers;
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
    return null;
  }

  updateApplicationState(application, validMapping);

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
  const sideEffects = getHandlersForAllEntryProcesses(transitionValidation);
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
        stateTransitionHandler,
        sideEffects,
      } = result;

      await saveApplication(updatedApplication, session);

      stateTransitionHandler && (await stateTransitionHandler(session));

      if (sideEffects?.length > 0) {
        await Promise.all(
          sideEffects.map((handler) => handler(command, session)),
        );
      }
    } else {
      // must throw if we're to retry any inbox events
      throw new Error(
        `Unable to process state change from ${application.currentStatus} to ${command.externalRequestedState}`,
      );
    }
  });
};
