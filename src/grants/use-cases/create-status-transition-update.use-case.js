import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { withAuditEvents } from "../../common/with-audit-events.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { Outbox } from "../models/outbox.js";
import { insertMany } from "../repositories/outbox.repository.js";

const writeStatusTransition = async ({
  clientRef,
  code,
  previousStatus,
  currentStatus,
  session,
}) => {
  const statusEvent = new ApplicationStatusUpdatedEvent({
    clientRef,
    code,
    previousStatus,
    currentStatus,
  });

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

const auditWriteStatusTransition = withAuditEvents(
  writeStatusTransition,
  ({ args: [{ clientRef, code, previousStatus, currentStatus }] }) => ({
    audit: {
      eventtype: "ApplicationStatusTransition",
      action: "STATUS_TRANSITION",
      entity: "Application",
      entityid: clientRef,
      details: { code, fromStatus: previousStatus, toStatus: currentStatus },
    },
  }),
);

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
      await auditWriteStatusTransition({
        clientRef,
        code,
        previousStatus: originalFullyQualifiedStatus,
        currentStatus: newFullyQualifiedStatus,
        session,
      });
    }

    logger.info(
      `Finished: Creating status transition update for application ${clientRef} with code ${code}`,
    );
  };
