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
const parcelReference = (entry) => entry.parcel ?? "";
const parcelArea = (entry, parcelsById) =>
  parcelsById.get(entry.parcel)?.area?.quantity;

const commonAgreementData = (agreement) => ({
  agreementId: agreement.agreementNumber,
  agreementStatus: agreement.state,
  ...optional("agreementStartDate", agreement.startDate),
  ...optional("agreementEndDate", agreement.endDate),
  ...optional("agreementValue", optionalPounds(agreement.totalAmountPence)),
});

const hasReportingOptionValues = ({
  optionStartDate,
  optionEndDate,
  optionQuantity,
  optionValue,
}) =>
  optionStartDate !== undefined &&
  optionEndDate !== undefined &&
  optionQuantity !== undefined &&
  optionValue !== undefined;

const toReportingOption = (entry, agreement, parcelsById) => {
  const option = {
    parcelReference: parcelReference(entry),
    ...optional("parcelSizeUnderAgreement", parcelArea(entry, parcelsById)),
    optionCode: entry.code,
    optionStartDate: valueOrFallback(entry.startDate, agreement.startDate),
    optionEndDate: valueOrFallback(entry.endDate, agreement.endDate),
    optionQuantity: entry.quantity,
    optionValue: optionalPounds(entry.totalAmountPence),
  };

  return hasReportingOptionValues(option) ? option : null;
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
    }),
  );
