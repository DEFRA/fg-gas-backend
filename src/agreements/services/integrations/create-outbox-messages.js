import { config } from "../../../common/config.js";
import { internalMessageBusTarget } from "../../../common/internal-command-bus.js";
import { createAgreementStatusUpdatedEvent } from "../../events/agreement-status-updated.event.js";

const createLifecycleMessages = (agreement, payment) => {
  const event = createAgreementStatusUpdatedEvent(agreement, payment);

  return [
    {
      event,
      target: internalMessageBusTarget,
    },
    {
      event,
      target: config.sns.agreementStatusUpdatedTopicArn,
    },
  ];
};

export const createOutboxMessages = (messageTypes, agreement, payment) =>
  messageTypes.flatMap((type) => {
    if (type !== "lifecycle") {
      throw new Error(`Unsupported Agreement outbox message type: "${type}"`);
    }
    return createLifecycleMessages(agreement, payment);
  });
