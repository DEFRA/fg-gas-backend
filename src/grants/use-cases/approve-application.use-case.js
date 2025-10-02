import { withTransaction } from "../../common/mongo-client.js";
import { update } from "../repositories/application.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";
// eslint-disable-next-line import-x/no-restricted-paths
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
// eslint-disable-next-line import-x/no-restricted-paths
import { config } from "../../common/config.js";
// eslint-disable-next-line import-x/no-restricted-paths
import { CreateAgreementCommand } from "../events/create-agreement.command.js";
import { EventPublication } from "../models/event-publication.js";
import { insertMany } from "../repositories/event-publication-outbox.respository.js";

export const approveApplicationUseCase = async ({ caseRef: clientRef, workflowCode: code }) => {
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


    const statusEventPublication = new EventPublication({
      event: statusUpdatedEvent,
      listenerId: config.sns.grantApplicationStatusUpdatedTopicArn,
    });

    // CREATE AGREEMENT COMMAND
    const createAgreementCommand = new CreateAgreementCommand(application);
    const createAgreementPublication = new EventPublication({
      event: createAgreementCommand,
      listenerId: config.sns.createAgreementTopicArn,
    });

    // insert as one call
    await insertMany(
      [statusEventPublication, createAgreementPublication],
      session,
    );

    return { application };
  });
};
