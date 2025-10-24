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
import { withTransaction } from "../../common/with-transaction.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { CreateAgreementCommand } from "../events/create-agreement.command.js";
import { Outbox } from "../models/outbox.js";
import {
  findByClientRef,
  update,
} from "../repositories/application.repository.js";
import { findByCode } from "../repositories/grant.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";

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

// ============================================================================
// OUTBOX CREATION - Entry Process Handlers
// ============================================================================
// "Entry processes" are side-effect actions that should be triggered when
// an application transitions into a specific state. For example, when an
// application moves to an "approved" state, we might need to generate an
// agreement document. These processes are defined in the grant configuration
// and are executed by publishing messages to the outbox for eventual processing.

/**
 * Registry mapping process names to their outbox record creators.
 * Each entry process (e.g., "GENERATE_AGREEMENT") has a corresponding
 * function that creates an outbox record with the appropriate command/event.
 */
const getOutboxCreatorForProcess = (processName) => {
  const processHandlers = {
    // When entering a state that requires an agreement, create a command
    // to generate the agreement document asynchronously
    GENERATE_AGREEMENT: (application) => {
      const createAgreementCommand = new CreateAgreementCommand(application);
      return new Outbox({
        event: createAgreementCommand,
        target: config.sns.createAgreementTopicArn,
      });
    },
    // Add more process handlers here as needed
  };

  return processHandlers[processName];
};

/**
 * Creates an outbox record for a single entry process.
 * Entry processes are actions that need to happen when transitioning into a state,
 * like sending notifications, generating documents, or triggering external workflows.
 */
const createOutboxRecordForEntryProcess = (processName, application) => {
  const outboxCreator = getOutboxCreatorForProcess(processName);
  if (outboxCreator) {
    return outboxCreator(application);
  }
  return null;
};

/**
 * Creates outbox records for all entry processes defined in the transition.
 * When an application transitions to a new state, the grant configuration may
 * specify multiple processes that should be triggered (e.g., send notification,
 * generate agreement, update external system). This function creates outbox
 * records for all of them.
 */
const createOutboxRecordsForAllEntryProcesses = (
  transitionValidation,
  application,
) => {
  if (!transitionValidation.entryProcesses) {
    return [];
  }

  const outboxRecords = [];
  for (const processName of transitionValidation.entryProcesses) {
    const outbox = createOutboxRecordForEntryProcess(processName, application);
    if (outbox) {
      outboxRecords.push(outbox);
    }
  }
  return outboxRecords;
};

/**
 * Creates an outbox record for a status update event if the status has changed.
 * This publishes an ApplicationStatusUpdatedEvent that downstream systems can
 * subscribe to (e.g., case working service, agreement service).
 */
const createOutboxForStatusUpdate = (
  application,
  originalFullyQualifiedStatus,
  newFullyQualifiedStatus,
) => {
  if (originalFullyQualifiedStatus !== newFullyQualifiedStatus) {
    const statusEvent = new ApplicationStatusUpdatedEvent({
      clientRef: application.clientRef,
      code: application.code,
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
  const statusUpdateOutbox = createOutboxForStatusUpdate(
    application,
    originalFullyQualifiedStatus,
    newFullyQualifiedStatus,
  );
  if (statusUpdateOutbox) {
    outboxRecords.push(statusUpdateOutbox);
  }

  // Add entry process outbox records
  const entryProcessOutboxes = createOutboxRecordsForAllEntryProcesses(
    transitionValidation,
    application,
  );
  outboxRecords.push(...entryProcessOutboxes);

  return { application, outboxRecords };
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
  return withTransaction(async (session) => {
    const application = await findByClientRef(command.clientRef);

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
      const { application: updatedApplication, outboxRecords } = result;
      return await saveApplicationWithOutbox(
        updatedApplication,
        outboxRecords,
        session,
      );
    }

    return null;
  });
};
