import { config } from "../../../common/config.js";
import { createAgreementStatusUpdatedEvent } from "../../events/agreement-status-updated.event.js";

const createLifecycleMessages = (agreement) => {
  const event = createAgreementStatusUpdatedEvent(agreement);

  return [{ event, target: config.sns.agreementStatusUpdatedTopicArn }];
};

export const createOutboxMessages = (messageTypes, agreement) =>
  messageTypes.flatMap((type) => {
    if (type !== "lifecycle") {
      throw new Error(`Unsupported Agreement outbox message type: "${type}"`);
    }
    return createLifecycleMessages(agreement);
  });
