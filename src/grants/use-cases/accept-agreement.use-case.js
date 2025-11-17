import { config } from "../../common/config.js";
import { UpdateCaseStatusCommand } from "../commands/update-case-status.command.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { Outbox } from "../models/outbox.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";

export const acceptAgreementUseCase = async (command, session) => {
  const { clientRef, code, eventData } = command;
  const { agreementNumber, date } = eventData;

  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );

  const previousStatus = application.getFullyQualifiedStatus();

  application.acceptAgreement(agreementNumber, date);

  const { currentPhase, currentStage } = application;

  await update(application, session);

  const statusEvent = new ApplicationStatusUpdatedEvent({
    clientRef,
    code,
    previousStatus,
    currentStatus: application.getFullyQualifiedStatus(),
  });

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
    ],
    session,
  );
};
