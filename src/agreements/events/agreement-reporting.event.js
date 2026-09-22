import {
  AGREEMENT_CREATED,
  AGREEMENT_STATUS_CHANGED,
  validateReportingEvent,
} from "@defra/grants-reporting-publisher";
import { config } from "../../common/config.js";

const REPORTING_SCHEMA_VERSION = "1.0.0";
const REPORTING_APPLICATION = "GAS";
const REPORTING_SERVICE = "grants";

const optional = (name, value) =>
  value === undefined ? {} : { [name]: value };

const penceToPounds = (value) => value / 100;
const optionalPounds = (value) =>
  value === undefined ? undefined : penceToPounds(value);
const valueOrFallback = (value, fallback) =>
  value === undefined ? fallback : value;
// Legacy persisted values may include a time; preserve their calendar date.
const calendarDate = (value) =>
  value === undefined ? undefined : value.slice(0, 10);
const reportingDateTime = (value, time) => {
  const date = calendarDate(value);
  return date === undefined ? undefined : `${date}T${time}Z`;
};
const reportingStartDateTime = (value) =>
  reportingDateTime(value, "00:00:00.000");
const reportingInclusiveEndDateTime = (value) =>
  reportingDateTime(value, "23:59:59.999");
const monthDayNumber = (date) => date.getUTCMonth() * 100 + date.getUTCDate();
const inclusiveWholeYears = (startDate, endDate) => {
  if (startDate === undefined || endDate === undefined) {
    return undefined;
  }

  const start = new Date(`${startDate}T00:00:00.000Z`);
  const exclusiveEnd = new Date(`${endDate}T00:00:00.000Z`);
  exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);

  const beforeStartAnniversary =
    monthDayNumber(exclusiveEnd) < monthDayNumber(start);

  return (
    exclusiveEnd.getUTCFullYear() -
    start.getUTCFullYear() -
    Number(beforeStartAnniversary)
  );
};
const parcelReference = (entry) => entry.parcel ?? "";
const parcelArea = (entry, parcelsById) =>
  parcelsById.get(entry.parcel)?.area?.quantity;

const commonAgreementData = (agreement) => ({
  agreementId: agreement.agreementNumber,
  agreementStatus: agreement.state,
  ...optional(
    "agreementStartDate",
    reportingStartDateTime(agreement.startDate),
  ),
  ...optional(
    "agreementEndDate",
    reportingInclusiveEndDateTime(agreement.endDate),
  ),
  ...optional("agreementValue", optionalPounds(agreement.totalAmountPence)),
});

const hasRequiredReportingOptionValues = ({ optionQuantity, optionValue }) =>
  optionQuantity !== undefined && optionValue !== undefined;

const toReportingOption = (entry, agreement, parcelsById) => {
  const optionStartDate = calendarDate(
    valueOrFallback(entry.startDate, agreement.startDate),
  );
  const optionEndDate = calendarDate(
    valueOrFallback(entry.endDate, agreement.endDate),
  );
  const option = {
    parcelReference: parcelReference(entry),
    ...optional("parcelSizeUnderAgreement", parcelArea(entry, parcelsById)),
    optionCode: entry.code,
    ...optional(
      "optionYear",
      inclusiveWholeYears(optionStartDate, optionEndDate),
    ),
    ...optional("optionStartDate", reportingStartDateTime(optionStartDate)),
    ...optional(
      "optionEndDate",
      reportingInclusiveEndDateTime(optionEndDate),
    ),
    optionQuantity: entry.quantity,
    optionValue: optionalPounds(entry.totalAmountPence),
  };

  return hasRequiredReportingOptionValues(option) ? option : null;
};

const reportingOptions = (agreement) => {
  const parcelsById = new Map(
    (agreement.parcels ?? []).map((parcel) => [parcel.id, parcel]),
  );

  return [...(agreement.actions ?? []), ...(agreement.items ?? [])]
    .map((entry) => toReportingOption(entry, agreement, parcelsById))
    .filter(Boolean);
};

const validate = (event) => {
  const { valid, errors } = validateReportingEvent(event);

  if (!valid) {
    throw new Error(`Invalid Agreement reporting event: ${errors.join(", ")}`);
  }

  return event;
};

const reportingEvent = (agreement, datetime, eventData) =>
  validate({
    correlationId: agreement.correlationId,
    datetime,
    version: REPORTING_SCHEMA_VERSION,
    application: REPORTING_APPLICATION,
    service: REPORTING_SERVICE,
    eventData,
  });

const publication = (agreement, event) => ({
  target: config.sns.reportingEventsTopicArn,
  segregationRef: agreement.agreementNumber,
  event,
});

export const createAgreementCreatedReportingPublication = (agreement) =>
  publication(
    agreement,
    reportingEvent(agreement, agreement.createdAt, {
      eventType: AGREEMENT_CREATED,
      ...commonAgreementData(agreement),
      agreementType: agreement.code,
      sbi: agreement.identifiers.sbi,
      options: reportingOptions(agreement),
    }),
  );

export const createAgreementStatusChangedReportingPublication = (agreement) =>
  publication(
    agreement,
    reportingEvent(agreement, agreement.updatedAt, {
      eventType: AGREEMENT_STATUS_CHANGED,
      ...commonAgreementData(agreement),
      statusDate: agreement.updatedAt,
      options: reportingOptions(agreement),
    }),
  );
