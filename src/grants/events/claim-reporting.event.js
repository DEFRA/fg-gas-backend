import {
  CLAIM_SUBMITTED,
  validateReportingEvent,
} from "@defra/grants-reporting-publisher";
import { config } from "../../common/config.js";
import { applicationRefsOf } from "../../events/case-refs.js";
import { OUTBOX, defineEventType } from "../../events/event-types.js";

export const reportingClaimSubmitted = defineEventType({
  name: "ClaimSubmittedReport",
  recognise: ({ eventData }) => eventData?.eventType === CLAIM_SUBMITTED,
  boxes: [OUTBOX],
});

export const createClaimSubmittedReportingPublication = ({
  claim,
  agreement,
}) => {
  const event = {
    correlationId: agreement.correlationId,
    datetime: claim.createdAt,
    version: "1.0.0",
    application: "GAS",
    service: "grants",
    eventData: {
      eventType: CLAIM_SUBMITTED,
      sbi: claim.metadata.sbi,
      agreementId: agreement.agreementNumber,
      claimId: claim.clientClaimRef,
      claimCode: claim.claimCode,
      claimStatus: "SUBMITTED",
      claimReceiptDate: claim.createdAt,
      claimValue: claim.claim.totalClaimAmountPence / 100,
    },
  };
  const { valid, errors } = validateReportingEvent(event);
  if (!valid) {
    throw new Error(`Invalid Claim reporting event: ${errors.join(", ")}`);
  }

  return {
    target: config.sns.reportingEventsTopicArn,
    segregationRef: agreement.agreementNumber,
    refs: applicationRefsOf(claim.code, claim.clientRef),
    event,
  };
};
