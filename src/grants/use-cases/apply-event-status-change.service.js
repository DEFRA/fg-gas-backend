import Boom from "@hapi/boom";
import {
  publishApplicationStatusUpdated,
  publishCreateAgreementCommand,
} from "../publishers/application-event.publisher.js";
import {
  findByClientRef,
  update,
} from "../repositories/application.repository.js";
import { findByCode } from "../repositories/grant.repository.js";

/**
 * Validate and get external state mapping
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
 * Update application with new state
 */
const updateApplicationState = (application, validMapping) => {
  application.currentPhase = validMapping.targetPhase;
  application.currentStage = validMapping.targetStage;
  application.currentStatus = validMapping.targetStatus;
  application.updatedAt = new Date().toISOString();
};

/**
 * Execute a single entry process
 */
const executeProcess = async (processName, application, eventData) => {
  const processFunction = resolveProcessNameToFunction(processName);
  if (processFunction) {
    await processFunction(application, eventData);
  }
};

/**
 * Execute entry processes for the transition
 */
const executeEntryProcesses = async (
  transitionValidation,
  application,
  eventData,
) => {
  if (!transitionValidation.entryProcesses) {
    return;
  }

  for (const processName of transitionValidation.entryProcesses) {
    await executeProcess(processName, application, eventData);
  }
};

/**
 * Publish status update event if status changed
 */
const publishStatusUpdateIfChanged = async (
  application,
  originalFqStatus,
  newFqStatus,
) => {
  if (originalFqStatus !== newFqStatus) {
    await publishApplicationStatusUpdated({
      clientRef: application.clientRef,
      code: application.code,
      previousStatus: originalFqStatus,
      currentStatus: newFqStatus,
    });
  }
};

/**
 * Process state transition
 */
const processStateTransition = async (application, grant, command) => {
  const originalFqStatus = application.getFullyQualifiedStatus();

  const validMapping = getValidatedMapping(grant, application, command);
  if (!validMapping) {
    return null;
  }

  const transitionValidation = grant.isValidTransition(
    validMapping.targetPhase,
    validMapping.targetStage,
    validMapping.targetStatus,
    originalFqStatus,
  );

  if (!transitionValidation.valid) {
    return null;
  }

  updateApplicationState(application, validMapping);

  const newFqStatus = application.getFullyQualifiedStatus();

  await publishStatusUpdateIfChanged(
    application,
    originalFqStatus,
    newFqStatus,
  );

  await executeEntryProcesses(
    transitionValidation,
    application,
    command.eventData,
  );

  return application;
};

/**
 * Apply an external state change to an application
 */

export const applyExternalStateChange = async (command) => {
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

  const updatedApplication = await processStateTransition(
    application,
    grant,
    command,
  );

  if (updatedApplication) {
    await update(updatedApplication);
  }
};

const resolveProcessNameToFunction = (processName) => {
  const processRegister = {
    GENERATE_AGREEMENT: publishCreateAgreementCommand,
  };

  return processRegister[processName];
};
