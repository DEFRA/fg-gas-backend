import { randomUUID } from "node:crypto";
import { config } from "../../../common/config.js";
import { internalOutboxTargets } from "../../../common/internal-outbox-targets.js";

const LIFECYCLE_TYPE = "io.onsite.agreement.status.updated";
const LIFECYCLE_SOURCE = "urn:service:agreement";

const acceptedLifecycleData = (agreement, payment) => ({
  agreementUrl: `${config.viewAgreementUri.replace(/\/$/, "")}/${agreement.agreementNumber}`,
  sbi: agreement.identifiers.sbi,
  startDate: agreement.startDate,
  endDate: agreement.endDate,
  ...(payment ? { claimId: payment.paymentHubClaimId } : {}),
});

const lifecycleData = (agreement, payment) => ({
  agreementNumber: agreement.agreementNumber,
  correlationId: agreement.correlationId,
  clientRef: agreement.clientRef,
  code: agreement.code,
  version: agreement.version,
  status: agreement.state,
  date: agreement.updatedAt,
  ...(agreement.state === "accepted"
    ? acceptedLifecycleData(agreement, payment)
    : {}),
});

const createLifecycleEvent = (agreement, payment) => ({
  id: randomUUID(),
  source: LIFECYCLE_SOURCE,
  specversion: "1.0",
  type: LIFECYCLE_TYPE,
  time: new Date().toISOString(),
  datacontenttype: "application/json",
  messageGroupId: `${agreement.clientRef}-${agreement.code}`,
  data: lifecycleData(agreement, payment),
});

const createLifecycleMessages = (agreement, payment) => {
  const event = createLifecycleEvent(agreement, payment);

  return [
    {
      event,
      target: internalOutboxTargets.AGREEMENTS,
    },
    {
      event,
      target: config.sns.agreementStatusUpdatedTopicArn,
    },
  ];
};

const outboxMessageCreators = {
  lifecycle: createLifecycleMessages,
};

const createOutboxMessagesForType = (type, agreement, payment) => {
  const createMessages = outboxMessageCreators[type];
  if (!createMessages) {
    throw new Error(`Unsupported Agreement outbox message type: "${type}"`);
  }
  return createMessages(agreement, payment);
};

export const createOutboxMessages = (messageTypes, agreement, payment) =>
  messageTypes.flatMap((type) =>
    createOutboxMessagesForType(type, agreement, payment),
  );
