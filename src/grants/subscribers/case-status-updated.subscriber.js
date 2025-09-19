import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { SqsSubscriber } from "../../common/sqs-subscriber.js";
import { approveApplicationUseCase } from "../use-cases/approve-application.use-case.js";

const APPROVED = "APPROVED";

export const caseStatusUpdatedSubscriber = new SqsSubscriber({
  queueUrl: config.sqs.updateStatusQueueUrl,
  async onMessage(message) {
    logger.info(
      `Case Status Updated Subscriber.  Status: ${message.data.currentStatus}`,
    );
    const { data } = message;

    if (data.currentStatus === APPROVED) {
      await approveApplicationUseCase(data);
    }
  },
});
