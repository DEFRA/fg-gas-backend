import { CloudEvent } from "../../../common/cloud-event.js";
import { config } from "../../../common/config.js";

const outboxMessageCreators = {
  lifecycle: (agreement) => {
    const { code } = agreement;
    const event = new CloudEvent(
      "agreement.status.updated",
      {
        agreementNumber: agreement.agreementNumber,
        correlationId: agreement.correlationId,
        clientRef: agreement.clientRef,
        code,
        version: agreement.version,
        status: agreement.state,
        date: agreement.updatedAt,
      },
      `${agreement.clientRef}-${code}`,
    );

    return { event, target: config.sns.updateAgreementStatusTopicArn };
  },
};

const createOutboxMessage = (type, agreement) => {
  const createMessage = outboxMessageCreators[type];
  if (!createMessage) {
    throw new Error(`Unsupported Agreement outbox message type: "${type}"`);
  }
  return createMessage(agreement);
};

export const createOutboxMessages = (messageTypes, agreement) =>
  messageTypes.map((type) => createOutboxMessage(type, agreement));
