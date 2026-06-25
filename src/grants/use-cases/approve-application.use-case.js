import {
  auditActions,
  auditEntities,
  buildAuditEvent,
} from "../../common/audit-constants.js";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { withAudit } from "../../common/with-audit.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { CreateAgreementCommand } from "../events/create-agreement.command.js";
import { Outbox } from "../models/outbox.js";
import { update } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";

const approveApplication = async (session, { clientRef, code }) => {
  logger.info(`Approving application ${clientRef} with code ${code}`);

  const application = await findApplicationByClientRefAndCodeUseCase(
    clientRef,
    code,
  );

  const previousStatus = application.getFullyQualifiedStatus();

  application.approve();

  const currentStatus = application.getFullyQualifiedStatus();

  await update(application, session);

  logger.debug(
    `Application ${clientRef} status updated from ${previousStatus} to ${currentStatus}`,
  );

  const statusEvent = new ApplicationStatusUpdatedEvent({
    clientRef,
    code,
    previousStatus,
    currentStatus,
  });

  const statusEventPublication = new Outbox({
    event: statusEvent,
    target: config.sns.grantApplicationStatusUpdatedTopicArn,
    segregationRef: Outbox.getSegregationRef(statusEvent),
  });

  const createAgreementCommand = new CreateAgreementCommand(application);

  const createAgreementPublication = new Outbox({
    event: createAgreementCommand,
    target: config.sns.createAgreementTopicArn,
    segregationRef: Outbox.getSegregationRef(createAgreementCommand),
  });

  await insertMany(
    [statusEventPublication, createAgreementPublication],
    session,
  );

  logger.info(`Finished: Approving application ${clientRef} with code ${code}`);

  return { previousStatus, currentStatus };
};

const buildApproveApplicationAuditEvent = ({
  entityid,
  details,
  messageGroupId,
}) =>
  buildAuditEvent({
    entity: auditEntities.APPLICATION,
    action: auditActions.APPROVE_APPLICATION,
    entityid,
    details,
    messageGroupId,
  });

export const approveApplicationUseCase = withAudit({
  transactional: true,
  run: approveApplication,
  audit: ({ args, result }) => {
    const [{ clientRef, code }] = args;
    return buildApproveApplicationAuditEvent({
      entityid: clientRef,
      details: {
        code,
        // @example of audit event using the result from calling use-case here...
        previousStatus: result?.previousStatus,
        currentStatus: result?.currentStatus,
      },
      messageGroupId: `${clientRef}-${code}`,
    });
  },
});
