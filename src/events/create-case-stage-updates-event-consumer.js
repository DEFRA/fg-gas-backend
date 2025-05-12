import { caseStageUpdatesQueueEventHandler } from "./case-stage-updates-queue-event-handler.js";
import sqsConsumerPlugin from "../common/sqs-consumer-plugin.js";

const createCaseStageUpdatesEventConsumer = (sqsQueueUrl, server) => ({
  plugin: sqsConsumerPlugin,
  options: {
    queueUrl: sqsQueueUrl,
    handleMessage: caseStageUpdatesQueueEventHandler(server),
  },
});
export { createCaseStageUpdatesEventConsumer };
