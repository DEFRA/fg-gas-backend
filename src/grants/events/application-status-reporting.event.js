import {
  APPLICATION_STATUS_CHANGED,
  validateReportingEvent,
} from "@defra/grants-reporting-publisher";
import { randomUUID } from "node:crypto";
import { config } from "../../common/config.js";
import { applicationRefsOf } from "../../events/case-refs.js";
import { OUTBOX, defineEventType } from "../../events/event-types.js";

export const reportingApplicationStatusChanged = defineEventType({
  name: "ApplicationStatusChangedReport",
  recognise: ({ eventData }) =>
    eventData?.eventType === APPLICATION_STATUS_CHANGED,
  boxes: [OUTBOX],
  refs: ({ eventData }) =>
    applicationRefsOf(eventData?.applicationType, eventData?.applicationId),
});

export const createApplicationStatusReportingPublication = ({
  application,
  previousApplicationStatus,
  applicationStatus,
  userId,
}) => {
  const { code, clientRef, updatedAt, identifiers } = application;
  const event = {
    correlationId: randomUUID(),
    datetime: updatedAt,
    version: "1.2.0",
    application: "GAS",
    service: "grants",
    eventData: {
      eventType: APPLICATION_STATUS_CHANGED,
      applicationId: clientRef,
      applicationType: code,
      sbi: identifiers.sbi,
      applicationStatus,
      ...(previousApplicationStatus && { previousApplicationStatus }),
      statusDate: updatedAt,
      ...(userId && { userId }),
    },
  };
  const { valid, errors } = validateReportingEvent(event);
  if (!valid) {
    throw new Error(
      `Invalid Application status reporting event: ${errors.join(", ")}`,
    );
  }

  return {
    event,
    target: config.sns.reportingEventsTopicArn,
    segregationRef: `${clientRef}-${code}`,
  };
};
