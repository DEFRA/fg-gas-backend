import { config } from "../../common/config.js";
import { SqsSubscriber } from "../../common/sqs-subscriber.js";
import { applicationStatus } from "../../common/status.js";
import { approveApplicationUseCase } from "../use-cases/approve-application.use-case.js";

export const caseStatusUpdatedSubscriber = new SqsSubscriber({
  queueUrl: config.updateStatusQueueUrl,
  async onMessage(message) {
    const { data } = message;

    const messageStatus = data.currentStatus.split(":")[2]; // e.g. PRE_AWARD:APPLICATION:RECEIVED or PRE_AWARD:APPLICATION:APPROVED

    if (messageStatus === applicationStatus.APPROVED) {
      await approveApplicationUseCase(data);
    }
  },
});
