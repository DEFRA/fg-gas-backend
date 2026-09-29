import { config } from "../../../common/config.js";
import { createAgreementStatusUpdatedEvent } from "../../events/agreement-status-updated.event.js";

const createLifecyclePublications = (agreement) => {
  const event = createAgreementStatusUpdatedEvent(agreement);

  return [{ event, target: config.sns.agreementStatusUpdatedTopicArn }];
};

export const createAgreementPublications = (messageTypes, agreement) =>
  messageTypes.flatMap((type) => {
    if (type !== "lifecycle") {
      throw new Error(`Unsupported Agreement publication type: "${type}"`);
    }
    return createLifecyclePublications(agreement);
  });
