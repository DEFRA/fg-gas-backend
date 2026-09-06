import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
import { isCalendarDate } from "../schemas/agreement-value.schema.js";
import {
  sourceItemActionValues,
  sourceItems,
  toExactNumber,
} from "./woodland-migration-source-values.js";

export { validateMappedWoodlandVersion } from "./validate-mapped-woodland-version.js";

const compact = (value) =>
  Object.fromEntries(
    Object.entries(value).filter(([, property]) => property !== undefined),
  );

const calendarDatePattern = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/;
const calendarDateFrom = (value) =>
  typeof value === "string" ? calendarDatePattern.exec(value)?.[1] : undefined;

const hasInvalidCalendarDate = (value) => {
  if (typeof value !== "string") {
    return false;
  }

  const calendarDate = calendarDateFrom(value);
  return !calendarDate || !isCalendarDate(calendarDate);
};

// eslint-disable-next-line complexity
const toIsoString = (value) => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (hasInvalidCalendarDate(value)) {
    return value;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toISOString();
};

const toDate = (value) => toIsoString(value)?.slice(0, 10);

// eslint-disable-next-line complexity
const mapApplicant = (applicant = {}) => ({
  business: {
    name: applicant.business?.name,
    address: compact({
      line1: applicant.business?.address?.line1,
      line2: applicant.business?.address?.line2,
      line3: applicant.business?.address?.line3,
      line4: applicant.business?.address?.line4,
      line5: applicant.business?.address?.line5,
      street: applicant.business?.address?.street,
      city: applicant.business?.address?.city,
      postalCode: applicant.business?.address?.postalCode,
    }),
  },
  customer: {
    name: compact({
      title: applicant.customer?.name?.title,
      first: applicant.customer?.name?.first,
      middle: applicant.customer?.name?.middle,
      last: applicant.customer?.name?.last,
    }),
  },
});

// eslint-disable-next-line complexity
const splitParcelId = ({ sheetId, parcelId = "" }) => {
  if (sheetId) {
    return {
      sheetId,
      parcelId: parcelId.startsWith(`${sheetId}-`)
        ? parcelId.slice(sheetId.length + 1)
        : parcelId,
    };
  }

  const separator = parcelId.indexOf("-");
  return separator < 1
    ? { parcelId }
    : {
        sheetId: parcelId.slice(0, separator),
        parcelId: parcelId.slice(separator + 1),
      };
};

const mapParcel = (parcel) => {
  const id = splitParcelId(parcel);
  return {
    id: `${id.sheetId}-${id.parcelId}`,
    ...id,
    area: parcel.area
      ? {
          quantity: toExactNumber(parcel.area.quantity),
          unit: parcel.area.unit,
        }
      : undefined,
  };
};

const matchingActionValues = (version, item, field) => [
  ...new Set(
    sourceItemActionValues(version, item, field).map((value) =>
      field === "quantity" ? toExactNumber(value) : value,
    ),
  ),
];

const only = (values) => (values.length === 1 ? values[0] : undefined);

// eslint-disable-next-line complexity
const mapItem = (version, item, index) => {
  const quantity =
    toExactNumber(item.quantity) ??
    only(matchingActionValues(version, item, "quantity"));
  const unit = item.unit ?? only(matchingActionValues(version, item, "unit"));

  return compact({
    id: `item:${index + 1}`,
    code: item.code,
    description: item.description,
    version: item.version?.toString(),
    quantity,
    unit: quantity === undefined ? undefined : unit,
    totalAmountPence: item.agreementTotalPence ?? item.annualPaymentPence,
  });
};

const woodlandSuffix = " WMP";
const woodlandName = (agreementName) =>
  agreementName?.toUpperCase().endsWith(woodlandSuffix)
    ? agreementName.slice(0, -woodlandSuffix.length)
    : agreementName;
const sourceAgreementName = (version) => version.agreementName ?? version.name;

const buildApplication = ({ version, applicant, parcels, items }) =>
  compact({
    woodlandName: woodlandName(sourceAgreementName(version)),
    applicant,
    landParcels: parcels.map((parcel) => ({
      parcelId: parcel.id,
      areaHa: parcel.area?.quantity,
    })),
    hectaresTenOrOverYearsOld: version.schemeData?.oldWoodlandAreaHa,
    hectaresUnderTenYearsOld: version.schemeData?.newWoodlandAreaHa,
    payments: {
      agreement: items.map((item) =>
        compact({
          code: item.code,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          agreementTotalPence: item.totalAmountPence,
        }),
      ),
    },
    totalAgreementPaymentPence: version.payment?.agreementTotalPence,
  });

/* eslint-disable complexity */
export const mapLegacyWoodlandVersion = ({
  agreement,
  grant,
  sourceVersion,
  version,
  configVersion,
}) => {
  const applicant = mapApplicant(sourceVersion.applicant);
  const parcels = (sourceVersion.application?.parcel ?? []).map(mapParcel);
  const items = sourceItems(sourceVersion).map((item, index) =>
    mapItem(sourceVersion, item, index),
  );
  const state = sourceVersion.status?.toLowerCase();
  const createdAt = toIsoString(
    agreement.createdAt ?? grant.createdAt ?? sourceVersion.createdAt,
  );

  const mappedAgreement = new Agreement({
    agreementNumber: agreement.agreementNumber,
    version,
    code: sourceVersion.code ?? grant.code,
    clientRef:
      sourceVersion.clientRef ?? grant.clientRef ?? agreement.clientRef,
    configVersion,
    correlationId: sourceVersion.correlationId,
    identifiers: sourceVersion.identifiers,
    schemeCode: sourceVersion.scheme ?? sourceVersion.schemeCode,
    name: sourceVersion.agreementName ?? sourceVersion.name,
    applicant,
    application: buildApplication({
      version: sourceVersion,
      applicant,
      parcels,
      items,
    }),
    startDate: toDate(sourceVersion.payment?.agreementStartDate),
    endDate: toDate(sourceVersion.payment?.agreementEndDate),
    parcels,
    actions: [],
    items,
    annualAmountPence: sourceVersion.payment?.annualTotalPence,
    totalAmountPence: sourceVersion.payment?.agreementTotalPence,
    state,
    createdAt,
    updatedAt: toIsoString(sourceVersion.updatedAt),
    acceptedAt:
      state === "accepted"
        ? toIsoString(sourceVersion.signatureDate)
        : undefined,
  });

  return new AgreementVersion({
    agreementNumber: mappedAgreement.agreementNumber,
    version: mappedAgreement.version,
    snapshot: mappedAgreement,
    versionedAt: toIsoString(sourceVersion.createdAt),
  });
};
/* eslint-enable complexity */
