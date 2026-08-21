import { randomUUID } from "node:crypto";
import { config } from "../../../common/config.js";
import { internalMessageBusTarget } from "../../../common/internal-command-bus.js";

const LIFECYCLE_TYPE = "io.onsite.agreement.status.updated";
const LIFECYCLE_SOURCE = "urn:service:agreement";

const acceptedLifecycleData = (agreement, claimId) => ({
  agreementUrl: `${config.viewAgreementUri.replace(/\/$/, "")}/${agreement.agreementNumber}`,
  sbi: agreement.identifiers.sbi,
  startDate: agreement.startDate,
  endDate: agreement.endDate,
  ...(claimId ? { claimId } : {}),
});

const lifecycleData = (agreement, claimId) => ({
  agreementNumber: agreement.agreementNumber,
  correlationId: agreement.correlationId,
  clientRef: agreement.clientRef,
  code: agreement.code,
  version: agreement.version,
  status: agreement.state,
  date: agreement.updatedAt,
  ...(agreement.state === "accepted"
    ? acceptedLifecycleData(agreement, claimId)
    : {}),
});

const createLifecycleEvent = (agreement, claimId) => ({
  id: randomUUID(),
  source: LIFECYCLE_SOURCE,
  specversion: "1.0",
  type: LIFECYCLE_TYPE,
  time: new Date().toISOString(),
  datacontenttype: "application/json",
  messageGroupId: `${agreement.clientRef}-${agreement.code}`,
  data: lifecycleData(agreement, claimId),
});

const createLifecycleMessages = (agreement, claimId) => {
  const event = createLifecycleEvent(agreement, claimId);

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

export const createOutboxMessages = (messageTypes, agreement, claimId) =>
  messageTypes.flatMap((type) => {
    if (type !== "lifecycle") {
      throw new Error(`Unsupported Agreement outbox message type: "${type}"`);
    }
    return createLifecycleMessages(agreement, claimId);
  });
