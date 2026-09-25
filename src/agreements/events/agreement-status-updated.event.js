import { randomUUID } from "node:crypto";
import { config } from "../../common/config.js";

export const AGREEMENT_STATUS_UPDATED_EVENT_TYPE =
  "io.onsite.agreement.status.updated";
export const AGREEMENT_STATUS_UPDATED_EVENT_SOURCE = "urn:service:agreement";

const acceptedLifecycleData = (agreement) => ({
  agreementUrl: `${config.viewAgreementUri.replace(/\/$/, "")}/${agreement.agreementNumber}`,
  sbi: agreement.identifiers.sbi,
  startDate: agreement.startDate,
  endDate: agreement.endDate,
});

const eventData = (agreement) => ({
  agreementNumber: agreement.agreementNumber,
  correlationId: agreement.correlationId,
  clientRef: agreement.clientRef,
  code: agreement.code,
  version: agreement.version,
  status: agreement.state,
  date: agreement.updatedAt,
  ...(agreement.state === "accepted" ? acceptedLifecycleData(agreement) : {}),
});

export const createAgreementStatusUpdatedEvent = (agreement) => ({
  id: randomUUID(),
  source: AGREEMENT_STATUS_UPDATED_EVENT_SOURCE,
  specversion: "1.0",
  type: AGREEMENT_STATUS_UPDATED_EVENT_TYPE,
  time: new Date().toISOString(),
  datacontenttype: "application/json",
  messageGroupId: `${agreement.clientRef}-${agreement.code}`,
  data: eventData(agreement),
});
