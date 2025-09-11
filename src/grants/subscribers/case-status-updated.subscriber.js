import { config } from "../../common/config.js";
import { SqsSubscriber } from "../../common/sqs-subscriber.js";
import { approveApplicationUseCase } from "../use-cases/approve-application.use-case.js";
import { findApplicationByClientRefUseCase } from "../use-cases/find-application-by-client-ref.use-case.js";

export const caseStatusUpdatedSubscriber = new SqsSubscriber({
  queueUrl: config.updateStatusQueueUrl,
  async onMessage(message) {
    const { data } = message;
    const application = await findApplicationByClientRefUseCase(data.clientRef);

    // only update application status if it has changed
    if (application.currentStatus !== data.currentStatus) {
      const status = data.currentStatus.split(":")[2]; // e.g. PRE_AWARD:APPLICATION:RECEIVED or PRE_AWARD:APPLICATION:APPROVED

      if (status === "APPROVED") {
        // only approve application if it has been approved by case worker
        await approveApplicationUseCase(data);
      }
    }
  },
});
