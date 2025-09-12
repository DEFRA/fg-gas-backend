import { config } from "../../common/config.js";
import { SqsSubscriber } from "../../common/sqs-subscriber.js";
import { updateApplicationStatusUseCase } from "../use-cases/update-application-status.use-case.js";

export const applicationAgreementUpdatedSubscriber = new SqsSubscriber({
  queueUrl: config.sqs.updateAgreementStatusQueueUrl,
  async onMessage(message) {
    const { data } = message;
    await updateApplicationStatusUseCase(data);
  },
});
