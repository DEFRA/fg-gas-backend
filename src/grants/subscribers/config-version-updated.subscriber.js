import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { SqsSubscriber } from "../../common/sqs-subscriber.js";
import {
  messageSource,
  saveInboxMessageUseCase,
} from "../use-cases/save-inbox-message.use-case.js";

const queueUrl = config.sqs.configVersionQueueUrl;

const subscriber = queueUrl
  ? new SqsSubscriber({
      queueUrl,
      async onMessage(message) {
        await saveInboxMessageUseCase(message, messageSource.ConfigBroker);
      },
    })
  : null;

export const configVersionUpdatedSubscriber = {
  start() {
    if (!subscriber) {
      logger.warn(
        "Config version queue URL not configured — subscriber disabled",
      );
      return;
    }
    subscriber.start();
  },
  stop() {
    subscriber?.stop();
  },
};
