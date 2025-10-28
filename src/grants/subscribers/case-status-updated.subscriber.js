import { config } from "../../common/config.js";
import { SqsSubscriber } from "../../common/sqs-subscriber.js";
import { saveInboxMessageUseCase } from "../use-cases/save-inbox-message.use-case.js";

export const caseStatusUpdatedSubscriber = new SqsSubscriber({
  queueUrl: config.sqs.updateStatusQueueUrl,
  async onMessage(message) {
    await saveInboxMessageUseCase(message);
  },
});
