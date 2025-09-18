import { ApplicationStatus } from "../../common/application-status.js";
import { config } from "../../common/config.js";
import { SqsSubscriber } from "../../common/sqs-subscriber.js";

import { approveApplicationUseCase } from "../use-cases/approve-application.use-case.js";

export const caseStatusUpdatedSubscriber = new SqsSubscriber({
  queueUrl: config.sqs.updateStatusQueueUrl,
  async onMessage(message) {
    const { data } = message;

    if (data.currentStatus === ApplicationStatus.Approved) {
      await approveApplicationUseCase(data);
    }
  },
});
