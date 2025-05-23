import * as sns from "../common/sns.js";
import * as grantService from "../grants/grant-service.js";
import { config } from "../common/config.js";
import { randomUUID } from "crypto";

const caseStageUpdatesQueueEventHandler = (server) => async (message) => {
  server.logger.info({
    message: "Received SQS message",
    body: message.MessageId,
  });

  const messageBody = JSON.parse(message.Body);

  const traceId = messageBody.data.traceParent;

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
      traceparent: traceId,
    };

    await sns.publish(config.grantApplicationApprovedTopic, event);

    server.logger.info({
      message: `Grant approval event sent: ${event.id}`,
      body: event,
    });
  }
};

export { caseStageUpdatesQueueEventHandler };
