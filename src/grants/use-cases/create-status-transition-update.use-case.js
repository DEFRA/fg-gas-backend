import {
  auditActions,
  auditEntities,
  buildAuditEvent,
} from "../../common/audit-constants.js";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { withAudit } from "../../common/with-audit.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { Outbox } from "../models/outbox.js";
import { insertMany } from "../repositories/outbox.repository.js";

const writeStatusTransition = async (
  { clientRef, code, previousStatus, currentStatus },
  session,
) => {
  const statusEvent = new ApplicationStatusUpdatedEvent({
    clientRef,
    code,
    previousStatus,
    currentStatus,
  });

  throw new Error("Julian Error");

  await insertMany(
    [
      new Outbox({
        event: statusEvent,
        target: config.sns.grantApplicationStatusUpdatedTopicArn,
        segregationRef: Outbox.getSegregationRef(statusEvent),
      }),
    ],
    session,
  );
};

const auditDataBuilder = (args, resultData) => {
  const [{ clientRef, code, previousStatus, currentStatus }] = args;

  return buildAuditEvent({
    entity: auditEntities.APPLICATION,
    action: auditActions.STATUS_TRANSITION,
    entityid: clientRef,
    details: { code, fromStatus: previousStatus, toStatus: currentStatus },
  });
};

const writeStatusTransitionWithAudit = withAudit(
  writeStatusTransition,
  auditDataBuilder,
);

/* {
  audit: ({ args }) => {
    const [{ clientRef, code, previousStatus, currentStatus }] = args;
    return buildAuditEvent({
      entity: auditEntities.APPLICATION,
      action: auditActions.STATUS_TRANSITION,
      entityid: clientRef,
      details: { code, fromStatus: previousStatus, toStatus: currentStatus },
    });
  },
  getSession: ({ args }) => args[1],
}); */

export const createStatusTransitionUpdateUseCase =
  ({
    originalFullyQualifiedStatus,
    newFullyQualifiedStatus,
    clientRef,
    code,
  }) =>
  async (session) => {
    logger.info(
      `Creating status transition update for application ${clientRef} with code ${code}`,
    );
    if (originalFullyQualifiedStatus !== newFullyQualifiedStatus) {
      await writeStatusTransitionWithAudit(
        {
          clientRef,
          code,
          previousStatus: originalFullyQualifiedStatus,
          currentStatus: newFullyQualifiedStatus,
        },
        session,
      );
    }

    logger.info(
      `Finished: Creating status transition update for application ${clientRef} with code ${code}`,
    );
  };
