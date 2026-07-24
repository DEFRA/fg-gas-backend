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

export const createOutboxMessages = (messageTypes, agreement) =>
  messageTypes.map((type) => outboxMessageCreators[type](agreement));
