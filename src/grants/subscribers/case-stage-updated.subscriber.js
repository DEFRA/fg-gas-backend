import { config } from "../../common/config.js";
import { SqsSubscriber } from "../../common/sqs-subscriber.js";
import { approveApplicationUseCase } from "../use-cases/approve-application.use-case.js";

export const caseStageUpdatedSubscriber = new SqsSubscriber({
  queueUrl: config.caseStageUpdatesQueueUrl,
  async onMessage(message) {
    const { data } = message;

    if (data.currentStage === "contract") {
      await approveApplicationUseCase(data.clientRef);
    }
  },
});
