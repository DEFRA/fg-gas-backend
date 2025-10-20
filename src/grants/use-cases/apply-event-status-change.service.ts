import Boom from "@hapi/boom";
import { Application } from "../models/application.js";
import type {
  ExternalStatusMapping,
  ValidExternalStatusMapping,
} from "../models/grant.js";
import {
  publishApplicationStatusUpdated,
  publishCreateAgreementCommand,
} from "../publishers/application-event.publisher.js";
import {
  findByClientRef,
  update,
} from "../repositories/application.repository.js";
import { findByCode } from "../repositories/grant.repository.js";

export type ApplyStateChangeCommand = {
  sourceSystem: string;
  clientRef: string;
  externalRequestedState: string;
  eventData: any;
};

export const applyExternalStateChange = async (
  command: ApplyStateChangeCommand,
) => {
  // Find the application by client reference
  const application = await findByClientRef(command.clientRef);

  if (!application) {
    throw Boom.notFound(
      `Application with clientRef "${command.clientRef}" not found`,
    );
  }

  // Find the grant definition for this application
  const grant = await findByCode(application.code);

  if (!grant) {
    throw Boom.notFound(`Grant with code "${application.code}" not found`);
  }

  // Capture the original status for comparison and event publishing
  const originalFqStatus = application.getFullyQualifiedStatus();

  // Map the external status from the source system to our internal phase/stage/status
  const mapping: ExternalStatusMapping = grant.mapExternalStateToInternalState(
    application.currentPhase,
    application.currentStage,
    command.externalRequestedState,
    command.sourceSystem,
  );

  // Only process if the external event is mapped for the source system
  // If not mapped, we silently ignore it (e.g., source system not configured for this grant)
  if (!mapping.valid) {
    return;
  }

  // Cast to valid mapping since we've confirmed it's valid
  const validMapping = mapping as ValidExternalStatusMapping;

  // Validate the transition is allowed based on the grant's validFrom rules
  // @ts-ignore - Grant.isValidTransition is defined in grant.js
  const transitionValidation = grant.isValidTransition(
    validMapping.targetPhase,
    validMapping.targetStage,
    validMapping.targetStatus,
    originalFqStatus,
  );

  // If transition is not valid according to grant rules, silently ignore
  if (!transitionValidation.valid) {
    return;
  }

  // Update the application's current phase, stage, and status
  application.currentPhase = validMapping.targetPhase;
  application.currentStage = validMapping.targetStage;
  application.currentStatus = validMapping.targetStatus;
  application.updatedAt = new Date().toISOString();

  // Get the new status after transition
  const newFqStatus = application.getFullyQualifiedStatus();

  // Only publish status update event if the status actually changed
  if (originalFqStatus !== newFqStatus) {
    await publishApplicationStatusUpdated({
      clientRef: application.clientRef,
      code: application.code,
      previousStatus: originalFqStatus,
      currentStatus: newFqStatus,
    });
  }

  // Execute any additional entryProcesses that were triggered by this transition
  // This may manipulate the application further (such as storing agreement data)
  // and publish specific Command messages to other systems such as Case Working or Agreements Service
  if (
    transitionValidation.entryProcesses &&
    transitionValidation.entryProcesses.length > 0
  ) {
    for (const processName of transitionValidation.entryProcesses) {
      const processFunction = resolveProcessNameToFunction(processName);
      if (processFunction) {
        await processFunction(application, command.eventData);
      }
    }
  }

  // Persist the updated application to the database
  await update(application);
};

function resolveProcessNameToFunction(processName: string) {
  // Registry of process names to their implementation functions
  // This could be built dynamically by some sort of type or convention in the future
  const processRegister: Record<
    string,
    (application: Application, eventData: any) => Promise<void>
  > = {
    GENERATE_AGREEMENT: publishCreateAgreementCommand,
  };

  return processRegister[processName];
}
