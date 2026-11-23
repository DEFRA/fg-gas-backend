import {
  APPLICATION_CREATED,
  validateReportingEvent,
} from "@defra/grants-reporting-publisher";
import { randomUUID } from "node:crypto";
import { config } from "../../common/config.js";
import { applicationRefsOf } from "../../events/case-refs.js";
import { OUTBOX, defineEventType } from "../../events/event-types.js";

export const reportingApplicationCreated = defineEventType({
  name: "ApplicationCreatedReport",
  recognise: ({ eventData }) => eventData?.eventType === APPLICATION_CREATED,
  boxes: [OUTBOX],
  refs: ({ eventData }) =>
    applicationRefsOf(eventData?.applicationType, eventData?.applicationId),
});

const waterReportingAnswers = (answers) => {
  const {
    applicant,
    projectLocated__easting: easting,
    projectLocated__northing: northing,
    itemsPlanningToInstall,
    reservoirs,
    waterStorageCapacity,
    waterDistributionLength,
    totalScore,
    scarcityScore,
    sectorScore,
    collaborationScore,
    planningAbstractionScore,
    estimatedMaxGrant,
  } = answers;

  return {
    applicant: { business: { name: applicant?.business?.name } },
    projectLocated__easting: easting,
    projectLocated__northing: northing,
    itemsPlanningToInstall,
    reservoirs: reservoirs?.map(({ name, type, size }) => ({
      name,
      type,
      size,
    })),
    waterStorageCapacity,
    waterDistributionLength,
    totalScore,
    scarcityScore,
    sectorScore,
    collaborationScore,
    planningAbstractionScore,
    estimatedMaxGrant,
  };
};

const reportingAnswersByGrant = new Map([
  ["water-management", waterReportingAnswers],
]);

const formatApplicantName = (answers) => {
  const applicant = answers.applicant ?? {};
  const customer = applicant.customer ?? {};
  const { first, middle, last } = customer.name ?? {};
  return [first, middle, last]
    .filter((part) => typeof part === "string" && part.trim())
    .map((part) => part.trim())
    .join(" ");
};

export const createApplicationReportingPublications = (application) => {
  const { code, clientRef, createdAt, identifiers, originalConfigVersion } =
    application;
  const mapAnswers = reportingAnswersByGrant.get(code);
  if (!mapAnswers) {
    return [];
  }

  const answers = application.getAnswers();

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
      applicantName: formatApplicantName(answers),
      grantConfigVersion: originalConfigVersion,
      applicationPayload: mapAnswers(answers),
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
