import { config } from "../../common/config.js";
import { UpdateCaseStatusCommand } from "../commands/update-case-status.command.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { Outbox } from "../models/outbox.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";

export const withdrawApplicationUseCase = async (command, session) => {
  const { clientRef, code } = command;

  const prevApplication = await findByClientRefAndCode({ clientRef, code });

  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );
  const { currentStage, currentPhase } = application;

  const previousStatus = prevApplication.getFullyQualifiedStatus();

  const agreement = application.getActiveAgreement();

  const outboxObjects = [];

  // if we have no agreement we simply withdraw the application...
  if (!agreement) {
    application.withdraw();
    await update(application, session);

    const statusCommand = new UpdateCaseStatusCommand({
      caseRef: clientRef,
      workflowCode: code,
      newStatus: application.getFullyQualifiedStatus(),
      phase: currentPhase,
      stage: currentStage,
    });

    outboxObjects.push(
      new Outbox({
        event: statusCommand,
        target: config.sns.updateCaseStatusTopicArn,
      }),
    );
  }

  const statusEvent = new ApplicationStatusUpdatedEvent({
    clientRef,
    code,
    previousStatus,
    currentStatus: application.getFullyQualifiedStatus(),
  });

  outboxObjects.push(
    new Outbox({
      event: statusEvent,
      target: config.sns.grantApplicationStatusUpdatedTopicArn,
    }),
  );
  await insertMany(outboxObjects, session);
};
