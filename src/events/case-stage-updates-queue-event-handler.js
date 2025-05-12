import * as sns from "../common/sns.js";
import * as grantService from "../grants/grant-service.js";
import { config } from "../common/config.js";

const caseStageUpdatesQueueEventHandler = (server) => async (message) => {
  server.logger.info({
    message: "Received SQS message",
    body: message.Body,
  });

  const grant = await grantService.findByCode(message.Body.code);

  if (message.Body.currentStage.id === "contract") {
    const event = {
      id: message.id,
      source: message.source,
      specVersion: message.spec.version,
      type: message.type,
      datacontenttype: "application/json",
      subject: message.subject,
      data: grant,
    };

    await sns.publish(config.grantApplicationApprovedTopic, event);

    server.logger.info({
      message: `Grant approval event sent: ${event}`,
      body: event,
    });
  }
};

export { caseStageUpdatesQueueEventHandler };
