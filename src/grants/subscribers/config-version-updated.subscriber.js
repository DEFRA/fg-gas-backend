import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { SqsSubscriber } from "../../common/sqs-subscriber.js";
import { saveConfigVersionInboxMessageUseCase } from "../use-cases/save-config-version-inbox-message.use-case.js";

const queueUrl = config.sqs.configVersionQueueUrl;

const subscriber = queueUrl
  ? new SqsSubscriber({
      queueUrl,
      async onMessage(body, messageAttributes, metadata) {
        await saveConfigVersionInboxMessageUseCase(
          body,
          messageAttributes,
          metadata,
        );
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
