import { config } from "../../common/config.js";
import { SqsSubscriber } from "../../common/sqs-subscriber.js";
// eslint-disable-next-line import-x/no-restricted-paths
import { ApplicationStatus } from "../models/application.js";

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
