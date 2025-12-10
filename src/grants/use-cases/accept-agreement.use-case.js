import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { UpdateCaseStatusCommand } from "../commands/update-case-status.command.js";
import { AgreementCreatedEvent } from "../events/agreement-created.event.js";
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

  logger.info(
    `Accepting agreement ${agreementNumber} for application ${clientRef} with code ${code}`,
  );

  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );

  const previousStatus = application.getFullyQualifiedStatus();

  application.acceptAgreement(agreementNumber, date);

  const { currentPhase, currentStage } = application;

  await update(application, session);

  logger.debug(
    `Application ${clientRef} status updated from ${previousStatus} to ${application.getFullyQualifiedStatus()}`,
  );

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

  // Create agreement created event with full application data
  const agreementCreatedEvent = new AgreementCreatedEvent({
    agreementNumber,
    answers: application.answers || {},
    clientRef,
    code,
    createdAt: date,
    identifiers: application.identifiers || {},
    notificationMessageId: `agreement-${agreementNumber}-${Date.now()}`,
    submittedAt: application.submittedAt || date,
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
        event: agreementCreatedEvent,
        target: config.sns.createAgreementTopicArn,
      }),
    ],
    session,
  );
  logger.info(
    `Finished: Accepting agreement ${agreementNumber} for application ${clientRef} with code ${code}`,
  );
};
