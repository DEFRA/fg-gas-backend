import { config } from "../../common/config.js";
import { Outbox } from "../../grants/models/outbox.js";
import { createAgreementLifecycleEventData } from "../events/agreement-lifecycle-event-data.js";
import { AgreementLifecycleEvent } from "../events/agreement-lifecycle.event.js";
import { CreatePaymentClaimCommand } from "../events/create-payment-claim.command.js";

const createLifecycleOutboxRecord = (event) =>
  new Outbox({
    event,
    target: config.sns.agreementStatusUpdatedTopicArn,
    segregationRef: Outbox.getSegregationRef(event),
  });

const createPaymentOutboxRecord = ({
  agreement,
  item,
  paymentClaim,
  version,
}) => {
  const event = new CreatePaymentClaimCommand({
    agreement,
    item,
    paymentClaim,
    version,
  });

  return new Outbox({
    event,
    target: config.sns.createPaymentTopicArn,
    segregationRef: event.messageGroupId,
  });
};

const createLifecycleEvent = ({ agreement, item, version }) =>
  new AgreementLifecycleEvent(
    createAgreementLifecycleEventData({ agreement, item, version }),
  );

export const createAgreementPublicationOutboxRecords = ({
  agreement,
  item,
  publication,
  version,
}) => [
  ...(publication.paymentClaim
    ? [
        createPaymentOutboxRecord({
          agreement,
          item,
          paymentClaim: publication.paymentClaim,
          version,
        }),
      ]
    : []),
  ...(publication.lifecycleEvent
    ? [
        createLifecycleOutboxRecord(
          createLifecycleEvent({ agreement, item, version }),
        ),
      ]
    : []),
];
