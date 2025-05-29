import * as sns from "../common/sns.js";
import * as grantService from "../grants/grant-service.js";
import { config } from "../common/config.js";
import { randomUUID } from "crypto";
import { logger } from "../common/logger.js";

const caseStageUpdatesQueueEventHandler =
  () => async (message, messageBody) => {
    logger.info({
      message: "Received SQS message",
      body: message.MessageId,
    });

    const application = await grantService.findApplicationByClientRef(
      messageBody.data.caseRef,
    );

    if (messageBody.data.currentStage === "contract") {
      const event = {
        id: randomUUID(),
        source: config.serviceName,
        specVersion: "1.0",
        type: `cloud.defra.${config.env}.${config.serviceName}.application.approved`,
        datacontenttype: "application/json",
        data: application,
      };

      await sns.publish(config.grantApplicationApprovedTopic, event);

      logger.info({
        message: `Grant approval event sent: ${event.id}`,
        body: event,
      });
    }
  };

export { caseStageUpdatesQueueEventHandler };
