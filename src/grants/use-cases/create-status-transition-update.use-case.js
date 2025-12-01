import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { Outbox } from "../models/outbox.js";
import { insertMany } from "../repositories/outbox.repository.js";

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
      const statusEvent = new ApplicationStatusUpdatedEvent({
        clientRef,
        code,
        previousStatus: originalFullyQualifiedStatus,
        currentStatus: newFullyQualifiedStatus,
      });

      await insertMany(
        [
          new Outbox({
            event: statusEvent,
            target: config.sns.grantApplicationStatusUpdatedTopicArn,
          }),
        ],
        session,
      );
    }

    logger.info(
      `Finished: Creating status transition update for application ${clientRef} with code ${code}`,
    );
  };
