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
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { Outbox } from "../models/outbox.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { findByCode } from "../repositories/grant.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
// eslint-disable-next-line import-x/no-restricted-paths
import { addAgreementUseCase } from "../use-cases/add-agreement.use-case.js";
// eslint-disable-next-line import-x/no-restricted-paths
import { createAgreementCommandUseCase } from "../use-cases/create-agreement-command.use-case.js";

/**
 * Maps an external status to an internal state and validates the mapping.
 * Different external systems (like Case Working) use different status codes,
 * which need to be translated to our internal phase/stage/status model.
 */
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

/**
 * Updates the application's state with the new phase, stage, and status.
 * Mutates the application object in place.
 */
const updateApplicationState = (application, validMapping) => {
  application.currentPhase = validMapping.targetPhase;
  application.currentStage = validMapping.targetStage;
  application.currentStatus = validMapping.targetStatus;
  application.updatedAt = new Date().toISOString();
};

/**
  mapping for transition process to use-cases
*/
const getHandlerForProcess = (processName) => {
  const processHandlers = {
    GENERATE_AGREEMENT: createAgreementCommandUseCase,
    STORE_AGREEMENT_CASE: addAgreementUseCase,
    // Add more process handlers here as needed
  };

  return processHandlers[processName];
};

/**
Attempt to map any additional actions that may need to be performed
on this state transition to a usecase which will be exectuted within the
withTransaction call
 */
// eslint-disable-next-line complexity
const getHandlersForAllEntryProcesses = (transitionValidation) => {
  if (!transitionValidation.entryProcesses) {
    return [];
  }

  const handlers = [];

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

/**
 * Creates an outbox record for a status update event if the status has changed.
 * This publishes an ApplicationStatusUpdatedEvent that downstream systems can
 * subscribe to (e.g., case working service, agreement service).
 */
// TODO move this to a usecase
const createOutboxForStatusUpdate = (
  application,
  originalFullyQualifiedStatus,
  newFullyQualifiedStatus,
) => {
  if (originalFullyQualifiedStatus !== newFullyQualifiedStatus) {
    const { clientRef, code } = application;
    const statusEvent = new ApplicationStatusUpdatedEvent({
      clientRef,
      code,
      previousStatus: originalFullyQualifiedStatus,
      currentStatus: newFullyQualifiedStatus,
    });

    return new Outbox({
      event: statusEvent,
      target: config.sns.grantApplicationStatusUpdatedTopicArn,
    });
  }
  return null;
};

// ============================================================================
// STATE TRANSITION ORCHESTRATION
// ============================================================================

/**
 * Orchestrates the entire state transition process:
 * 1. Maps external status to internal state
 * 2. Validates the transition is allowed
 * 3. Updates the application state
 * 4. Creates outbox records for events and side effects
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

  // Collect all outbox records
  const outboxRecords = [];
  // Add status update outbox record if status changed
  const outboxMessage = createOutboxForStatusUpdate(
    application,
    originalFullyQualifiedStatus,
    newFullyQualifiedStatus,
  );
  if (outboxMessage) {
    outboxRecords.push(outboxMessage);
  }

  // some transitions require additional logic - this is handled by external use
  // cases and run alongside the application update.
  const handlers = getHandlersForAllEntryProcesses(transitionValidation);
  return { application, outboxRecords, handlers };
};

// ============================================================================
// PERSISTENCE
// ============================================================================

/**
 * Persists the updated application and outbox records atomically within a transaction.
 * This ensures that either both the state change and the outbox records are saved,
 * or neither are (maintaining data consistency).
 */
const saveApplicationWithOutbox = async (
  updatedApplication,
  outboxRecords,
  session,
) => {
  await update(updatedApplication, session);

  if (outboxRecords.length > 0) {
    await insertMany(outboxRecords, session);
  }

  return { application: updatedApplication };
};

// ============================================================================
// PUBLIC API
// ============================================================================

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
 * 4. Saves application and outbox records atomically
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
        outboxRecords,
        handlers,
      } = result;
      await saveApplicationWithOutbox(
        updatedApplication,
        outboxRecords,
        session,
      );
      const handlerData = {
        ...command,
        application: updatedApplication,
      };
      if (handlers?.length > 0) {
        await Promise.all(
          handlers.map((handler) => handler(handlerData, session)),
        );
      }
    } else {
      throw new Error(
        `Unable to process state change from ${application.currentStatus} to ${command.externalRequestedState}`,
      );
    }
  });
};
