import sqsConsumerPlugin from "../events/sqs-consumer-plugin.js";
import { caseStageUpdatesQueueEventHandler } from "../events/case-stage-updates-queue-event-handler.js";

const caseStageUpdatesQueueConsumer = (sqsQueueUrl, server) => ({
  plugin: sqsConsumerPlugin,
  options: {
    queueUrl: sqsQueueUrl,
    handleMessage: caseStageUpdatesQueueEventHandler(server),
  },
});
export { caseStageUpdatesQueueConsumer };
