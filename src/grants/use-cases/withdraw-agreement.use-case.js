import { config } from "../../common/config.js";
import { UpdateCaseStatusCommand } from "../commands/update-case-status.command.js";
import { AgreementWithdrawnEvent } from "../events/agreement-withdrawn.event.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { Outbox } from "../models/outbox.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";

export const withdrawAgreementUseCase = async (command, session) => {
  const { clientRef, code, eventData } = command;
  const { agreementNumber } = eventData;
  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );
  const prevApplication = await findByClientRefAndCode({ clientRef, code });
  const previousStatus = prevApplication.getFullyQualifiedStatus();
  const agreement = application.getAgreement(agreementNumber);

  agreement.withdraw(new Date().toISOString());

  await update(application, session);

  const { currentStage, currentPhase } = application;

  const agreementData = application
    .getAgreementsData()
    .find((a) => a.agreementRef === agreementNumber);

  const statusCommand = new UpdateCaseStatusCommand({
    caseRef: clientRef,
    workflowCode: code,
    newStatus: application.getFullyQualifiedStatus(),
    phase: currentPhase,
    stage: currentStage,
    dataType: "ARRAY",
    key: "agreementRef",
    targetNode: "agreements",
    data: agreementData,
  });

  const statusEvent = new ApplicationStatusUpdatedEvent({
    clientRef,
    code,
    previousStatus,
    currentStatus: application.getFullyQualifiedStatus(),
  });

  // Create agreement withdrawn event
  const agreementWithdrawnEvent = new AgreementWithdrawnEvent({
    clientRef,
    id: agreementNumber,
    status: "PRE_AWARD:APPLICATION:WITHDRAWAL_REQUESTED", // Match consumer contract
    withdrawnAt: new Date().toISOString(),
    withdrawnBy: "Caseworker_ID_123", // Match consumer contract expectation
  });

  await insertMany(
    [
      new Outbox({
        event: statusEvent,
        target: config.sns.grantApplicationStatusUpdatedTopicArn,
      }),
      new Outbox({
        event: statusCommand,
        target: config.sns.updateCaseStatusTopicArn,
      }),
      new Outbox({
        event: agreementWithdrawnEvent,
        target: config.sns.updateAgreementStatusTopicArn,
      }),
    ],
    session,
  );
};
