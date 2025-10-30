import { config } from "../../common/config.js";
import { SqsSubscriber } from "../../common/sqs-subscriber.js";
import {
  messageSource,
  saveInboxMessageUseCase,
} from "../use-cases/save-inbox-message.use-case.js";

export const agreementStatusUpdatedSubscriber = new SqsSubscriber({
  queueUrl: config.sqs.updateAgreementStatusQueueUrl,
  async onMessage(message) {
    await saveInboxMessageUseCase(message, messageSource.AgreementService);
  },
});
