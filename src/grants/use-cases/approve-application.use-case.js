import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { CreateAgreementCommand } from "../events/create-agreement.command.js";
import { Outbox } from "../models/outbox.js";
import { update } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";

export const approveApplicationUseCase = async ({ clientRef, code }) => {
  logger.info(`Approving application ${clientRef} with code ${code}`);
  return withTransaction(async (session) => {
    const application = await findApplicationByClientRefAndCodeUseCase(
      clientRef,
      code,
    );

    const previousStatus = application.getFullyQualifiedStatus();

    application.approve();

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

    // UPDATE STATUS
    const statusEventPublication = new Outbox({
      event: statusEvent,
      target: config.sns.grantApplicationStatusUpdatedTopicArn,
    });

    // CREATE AGREEMENT COMMAND
    const createAgreementCommand = new CreateAgreementCommand(application);

    const createAgreementPublication = new Outbox({
      event: createAgreementCommand,
      target: config.sns.createAgreementTopicArn,
    });

    await insertMany(
      [statusEventPublication, createAgreementPublication],
      session,
    );

    logger.info(
      `Finished: Approving application ${clientRef} with code ${code}`,
    );

    return { application };
  });
};
