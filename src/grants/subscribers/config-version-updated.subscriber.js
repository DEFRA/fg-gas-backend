import { config } from "../../common/config.js";
import { SqsSubscriber } from "../../common/sqs-subscriber.js";
import {
  messageSource,
  saveInboxMessageUseCase,
} from "../use-cases/save-inbox-message.use-case.js";

export const configVersionUpdatedSubscriber = new SqsSubscriber({
  queueUrl: config.sqs.configVersionQueueUrl,
  async onMessage(message) {
    await saveInboxMessageUseCase(message, messageSource.ConfigBroker);
  },
});
