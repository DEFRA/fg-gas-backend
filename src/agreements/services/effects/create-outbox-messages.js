import { randomUUID } from "node:crypto";
import { config } from "../../../common/config.js";

const LIFECYCLE_TYPE = "io.onsite.agreement.status.updated";
const LIFECYCLE_SOURCE = "urn:service:agreement";

const acceptedLifecycleData = (agreement, payment) => ({
  agreementUrl: `${config.viewAgreementUri.replace(/\/$/, "")}/${agreement.agreementNumber}`,
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

const outboxMessageCreators = {
  lifecycle: (agreement, payment) => ({
    event: createLifecycleEvent(agreement, payment),
    target: config.sns.updateAgreementStatusTopicArn,
  }),
};

const createOutboxMessage = (type, agreement, payment) => {
  const createMessage = outboxMessageCreators[type];
  if (!createMessage) {
    throw new Error(`Unsupported Agreement outbox message type: "${type}"`);
  }
  return createMessage(agreement, payment);
};

export const createOutboxMessages = (messageTypes, agreement, payment) =>
  messageTypes.map((type) => createOutboxMessage(type, agreement, payment));
