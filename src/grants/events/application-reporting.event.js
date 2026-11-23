import {
  APPLICATION_CREATED,
  validateReportingEvent,
} from "@defra/grants-reporting-publisher";
import { randomUUID } from "node:crypto";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { applicationRefsOf } from "../../events/case-refs.js";
import { OUTBOX, defineEventType } from "../../events/event-types.js";

export const reportingApplicationCreated = defineEventType({
  name: "ApplicationCreatedReport",
  recognise: ({ eventData }) => eventData?.eventType === APPLICATION_CREATED,
  boxes: [OUTBOX],
  refs: ({ eventData }) =>
    applicationRefsOf(eventData?.applicationType, eventData?.applicationId),
});

const formatApplicantName = (name) => {
  if (typeof name === "string") {
    return name.trim();
  }
  const { first, middle, last } = name ?? {};
  return [first, middle, last]
    .filter((part) => typeof part === "string" && part.trim())
    .map((part) => part.trim())
    .join(" ");
};

const getApplicantName = ({ applicant }) =>
  formatApplicantName(applicant?.customer?.name);

export const createApplicationReportingPublications = (application) => {
  const { code, clientRef, createdAt, identifiers, originalConfigVersion } =
    application;
  const answers = application.getAnswers();
  const applicantName = getApplicantName(answers);
  if (!applicantName) {
    // The publisher currently requires a name, but some grants do not capture it.
    logger.warn(
      { code, clientRef },
      "Application report skipped: no applicant name",
    );
    return [];
  }

  const event = {
    correlationId: randomUUID(),
    datetime: createdAt,
    version: "1.1.0",
    application: "GAS",
    service: "grants",
    eventData: {
      eventType: APPLICATION_CREATED,
      sbi: identifiers.sbi,
      crn: identifiers.crn,
      applicationId: clientRef,
      applicationType: code,
      applicationReceiptDate: createdAt,
      applicantName,
      grantConfigVersion: originalConfigVersion,
      applicationPayload: answers,
    },
  };
  const { valid, errors } = validateReportingEvent(event);
  if (!valid) {
    throw new Error(
      `Invalid Application reporting event: ${errors.join(", ")}`,
    );
  }

  return [
    {
      target: config.sns.reportingEventsTopicArn,
      segregationRef: `${clientRef}-${code}`,
      event,
    },
  ];
};
