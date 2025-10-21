import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { SqsSubscriber } from "../../common/sqs-subscriber.js";
import { saveInboxMessageUseCase } from "../use-cases/save-inbox-message.use-case.js";

const APPROVED = "APPROVED";

export const caseStatusUpdatedSubscriber = new SqsSubscriber({
  queueUrl: config.sqs.updateStatusQueueUrl,
  async onMessage(message) {
    const { data } = message;

    if (data.currentStatus === APPROVED) {
      logger.info("handle case status update message");
      await saveInboxMessageUseCase(message, "approveApplicationUseCase");
    }
  },
});
