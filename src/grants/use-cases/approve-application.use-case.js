import { withTransaction } from "../../common/mongo-client.js";
import { update } from "../repositories/application.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";
// eslint-disable-next-line import-x/no-restricted-paths
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
// eslint-disable-next-line import-x/no-restricted-paths
import { config } from "../../common/config.js";
// eslint-disable-next-line import-x/no-restricted-paths
import { CreateAgreementCommand } from "../events/create-agreement.command.js";
import { Outbox } from "../models/outbox.js";
import { insertMany } from "../repositories/outbox.respository.js";
import { getInstanceId } from "../../common/get-instance-id.js";

export const approveApplicationUseCase = async ({
  caseRef: clientRef,
  workflowCode: code,
}) => {
  // some way to id the current instance
  const hostname = getInstanceId();
  return withTransaction(async (session) => {
    const application = await findApplicationByClientRefAndCodeUseCase(
      clientRef,
      code,
      session,
    );

    const previousStatus = application.getFullyQualifiedStatus();
    application.approve();

    await update(application, session);

    // add events to outbox
    // GENERIC STATUS UPDATE
    const statusUpdatedEvent = new ApplicationStatusUpdatedEvent({
      clientRef,
      code,
      previousStatus,
      currentStatus: application.getFullyQualifiedStatus(),
    });

    const statusEventPublication = new Outbox({
      hostname,
      event: statusUpdatedEvent,
      target: config.sns.grantApplicationStatusUpdatedTopicArn,
    });

    // CREATE AGREEMENT COMMAND
    const createAgreementCommand = new CreateAgreementCommand(application);
    const createAgreementPublication = new Outbox({
      hostname,
      event: createAgreementCommand,
      target: config.sns.createAgreementTopicArn,
    });

    // insert as one call
    await insertMany(
      [statusEventPublication, createAgreementPublication],
      session,
    );

    return { application };
  });
};
