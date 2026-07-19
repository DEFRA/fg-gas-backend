import { config } from "../../../common/config.js";
import { AgreementStatusUpdatedEvent } from "../../events/agreement-status-updated.event.js";

export const createAgreementStatusUpdatedOutboundEvent = (context) => {
  requirePdfConfiguration();
  const { startDate, endDate } = getAgreementDates(context);

  return {
    event: new AgreementStatusUpdatedEvent({
      agreementNumber: context.agreement.agreementNumber,
      correlationId: context.item.correlationId,
      clientRef: context.item.clientRef,
      version: context.version,
      agreementUrl: buildAgreementUrl(context.agreement.agreementNumber),
      status: context.target,
      code: context.item.agreementCode,
      date: getAgreementDate(context),
      startDate,
      endDate,
      claimId: context.item.supplementaryData?.claimId,
    }),
    target: config.sns.agreementStatusUpdatedTopicArn,
  };
};

const requirePdfConfiguration = () => {
  if (!config.sns.agreementStatusUpdatedTopicArn) {
    throw new Error(
      "GAS__SNS__AGREEMENT_STATUS_UPDATED_TOPIC_ARN is required to publish Agreement status updates",
    );
  }

  if (!config.viewAgreementUri) {
    throw new Error(
      "VIEW_AGREEMENT_URI is required to publish Agreement status updates",
    );
  }
};

const getAgreementDate = (context) =>
  context.target === "accepted" ? context.item.acceptedAt : context.executedAt;

const getAgreementDates = (context) =>
  context.item.supplementaryData?.agreementDates ?? {};

const buildAgreementUrl = (agreementNumber) =>
  `${config.viewAgreementUri.replace(/\/$/, "")}/${agreementNumber}`;
