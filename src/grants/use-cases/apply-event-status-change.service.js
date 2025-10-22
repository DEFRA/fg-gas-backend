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

/**
 * Create outbox record for a single entry process
 */
const createOutboxForProcess = (processName, application) => {
  const outboxCreator = resolveProcessNameToOutboxCreator(processName);
  if (outboxCreator) {
    return outboxCreator(application);
  }
  return null;
};

/**
 * Create outbox records for entry processes
 */
const createOutboxForEntryProcesses = (transitionValidation, application) => {
  if (!transitionValidation.entryProcesses) {
    return [];
  }

  const outboxRecords = [];
  for (const processName of transitionValidation.entryProcesses) {
    const outbox = createOutboxForProcess(processName, application);
    if (outbox) {
      outboxRecords.push(outbox);
    }
  }
  return outboxRecords;
};

/**
 * Create outbox record for status update if status changed
 */
const createOutboxForStatusUpdate = (
  application,
  originalFqStatus,
  newFqStatus,
) => {
  if (originalFqStatus !== newFqStatus) {
    const statusEvent = new ApplicationStatusUpdatedEvent({
      clientRef: application.clientRef,
      code: application.code,
      previousStatus: originalFqStatus,
      currentStatus: newFqStatus,
    });

    return new Outbox({
      event: statusEvent,
      target: config.sns.grantApplicationStatusUpdatedTopicArn,
    });
  }
  return null;
};

const processStateTransition = (application, grant, command) => {
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

  // Collect all outbox records
  const outboxRecords = [];

  // Add status update outbox record if status changed
  const statusUpdateOutbox = createOutboxForStatusUpdate(
    application,
    originalFqStatus,
    newFqStatus,
  );
  if (statusUpdateOutbox) {
    outboxRecords.push(statusUpdateOutbox);
  }

  // Add entry process outbox records
  const entryProcessOutboxes = createOutboxForEntryProcesses(
    transitionValidation,
    application,
  );
  outboxRecords.push(...entryProcessOutboxes);

  return { application, outboxRecords };
};

/**
 * Save application and outbox records within a transaction
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

const resolveProcessNameToOutboxCreator = (processName) => {
  const processRegister = {
    GENERATE_AGREEMENT: (application) => {
      const createAgreementCommand = new CreateAgreementCommand(application);
      return new Outbox({
        event: createAgreementCommand,
        target: config.sns.createAgreementTopicArn,
      });
    },
  };

  return processRegister[processName];
};
