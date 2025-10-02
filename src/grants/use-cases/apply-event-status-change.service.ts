
import { findByClientRef } from "../repositories/application.repository.js";
import { findByCode } from "../repositories/grant.repository.js";
import {Application} from "../models/application";
import {
  publishApplicationApproved,
  publishApplicationStatusUpdated
} from "../publishers/application-event.publisher.js";
import { update } from "../repositories/application.repository.js";
// import Boom from "@hapi/boom";
import {ExternalStatusMapping, Grant, ValidExternalStatusMapping} from "../models/grant";

export type ApplyStateChangeCommand = {
  sourceSystem: string;
  clientRef: string;
  externalRequestedState: string;
  eventData: any
}

export const applyStateChange = async () => {

}

export const applyExternalStateChange = async (command: ApplyStateChangeCommand) => {

  // Should be run in a transaction started by the 'event handler' (important when we use inbox for marking incoming events as done)

  const application : Application = await findByClientRef(command.clientRef);
  // return if not found - GAS knows nothing about this

  const grant : Grant = await findByCode(application.code);
  // return if not found - GAS knows nothing about this

  const originalFqStatus = application.getFullyQualifiedStatus();

  const mapping : ExternalStatusMapping  = grant.mapExternalStateToInternalState(
    application.currentPhase,
    application.currentStage,
    command.externalRequestedState,
    command.sourceSystem
  );

  // Only process if the external event is mapped for a source system
  if (!mapping.valid) {
    return
  }

  // It is valid so cast
  const validMapping = mapping as ValidExternalStatusMapping

  // Transition and get and additional processes
  const additionalProcesses = application.transitionStatus(
    grant,
    validMapping.targetPhase,
    validMapping.targetStage,
    validMapping.targetStatus
  )

  // Should we stop if the status didn't change ????


  // Publish the general ApplicationStatusUpdatedEvent is the status has changed
  await publishApplicationStatusUpdated({
    clientRef: application.clientRef,
    oldStatus: originalFqStatus,
    newStatus: application.getFullyQualifiedStatus()
  });

  // Now execute the AdditionalProcesses
  // This may manipulate the application further (such as store the agreement data)
  // and publish any specific Command messages to other systems such as Case Working
  // or Agreements Service

  additionalProcesses.processes.forEach(process => {
    const processFunction = resolveProcessNameToFunction(process);
    if (processFunction) {
      processFunction(application, originalFqStatus, command.eventData);
    }
  })

  // Persist the updated application
  await update(application);

  // Commit transaction will be handled by the inbox poller that called this method

}

function resolveProcessNameToFunction(process: string) {
  // Hopefully this could be built dynamically by some sort of type or convention
  const register = {
    "GENERATE_AGREEMENT": publishApplicationApproved
  }
  return register[process];
}
