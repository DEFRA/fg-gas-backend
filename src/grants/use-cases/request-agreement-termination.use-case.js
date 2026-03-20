import { config } from "../../common/config.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { UpdateAgreementStatusCommand } from "../events/update-agreement-status.command.js";
import { AgreementServiceStatus } from "../models/agreement.js";
import { Outbox } from "../models/outbox.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";

export const requestAgreementTerminationUseCase = async (command, session) => {
  const { clientRef, code } = command;

  const prevApplication = await findByClientRefAndCode({ clientRef, code });
  const previousStatus = prevApplication.getFullyQualifiedStatus();

  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );

  const agreement = application.getAcceptedAgreement();

  const outboxObjects = [];

  if (agreement) {
    const updateAgreementStatusCommand = new UpdateAgreementStatusCommand({
      clientRef,
      code,
      status: AgreementServiceStatus.Terminated,
      agreementNumber: agreement.agreementRef,
    });

    outboxObjects.push(
      new Outbox({
        event: updateAgreementStatusCommand,
        target: config.sns.updateAgreementStatusTopicArn,
        segregationRef: Outbox.getSegregationRef(updateAgreementStatusCommand),
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
      segregationRef: Outbox.getSegregationRef(statusEvent),
    }),
  );

  await insertMany(outboxObjects, session);
};
