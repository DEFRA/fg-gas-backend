import Joi from "joi";
import { Agreement } from "../models/agreement.js";
import { agreementValueSchema } from "../schemas/agreement-value.schema.js";

const supportedStates = ["offered", "accepted"];

const compact = (value) =>
  Object.fromEntries(
    Object.entries(value).filter(([, property]) => property !== undefined),
  );

// eslint-disable-next-line complexity
const normaliseDecimal = (value) => {
  const [, sign, integer, fraction = "", sourceExponent = "0"] =
    value.match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i) ?? [];

  if (integer === undefined) {
    return undefined;
  }

  let digits = `${integer}${fraction}`.replace(/^0+/, "") || "0";
  let exponent = Number(sourceExponent) - fraction.length;

  if (digits === "0") {
    return digits;
  }

  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    exponent += 1;
  }

  return `${sign}${digits}e${exponent}`;
};

const toNumber = (value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const source = value.toString();
  const number = Number(source);
  return normaliseDecimal(source) === normaliseDecimal(number.toString())
    ? number
    : Number.NaN;
};

// eslint-disable-next-line complexity
const toIsoString = (value) => {
  if (value === undefined || value === null) {
    return undefined;
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
          quantity: toNumber(parcel.area.quantity),
          unit: parcel.area.unit,
        }
      : undefined,
  };
};

const entries = (value) =>
  value instanceof Map ? [...value.values()] : Object.values(value ?? {});

// eslint-disable-next-line complexity
const sourceItems = (version) => {
  const paymentItems = entries(version.payment?.agreementLevelItems);
  return paymentItems.length > 0
    ? paymentItems
    : (version.application?.agreement ?? []);
};

const sourceParcelActions = (version) => [
  ...(version.actionApplications ?? []).map((action, index) => ({
    action,
    path: `actionApplications.${index}`,
  })),
  ...(version.application?.parcel ?? []).flatMap((parcel, parcelIndex) =>
    (parcel.actions ?? []).map((action, actionIndex) => ({
      action,
      path: `application.parcel.${parcelIndex}.actions.${actionIndex}`,
    })),
  ),
];

const matchingActionValues = (version, item, field) => [
  ...new Set(
    sourceParcelActions(version)
      .map(({ action }) => action)
      .filter((action) => action.code === item.code)
      .map((action) => action.appliedFor?.[field])
      .filter((value) => value !== undefined && value !== null)
      .map((value) => (field === "quantity" ? toNumber(value) : value)),
  ),
];

const only = (values) => (values.length === 1 ? values[0] : undefined);

// eslint-disable-next-line complexity
const mapItem = (version, item, index) => {
  const quantity =
    toNumber(item.quantity) ??
    only(matchingActionValues(version, item, "quantity"));
  const unit = item.unit ?? only(matchingActionValues(version, item, "unit"));

  return compact({
    id: `item:${index + 1}`,
    code: item.code,
    description: item.description,
    version: item.version?.toString(),
    quantity,
    unit: quantity === undefined ? undefined : (unit ?? "ha"),
    totalAmountPence: item.agreementTotalPence ?? item.annualPaymentPence,
  });
};

const woodlandSuffix = " WMP";
const woodlandName = (agreementName) =>
  agreementName?.toUpperCase().endsWith(woodlandSuffix)
    ? agreementName.slice(0, -woodlandSuffix.length)
    : agreementName;

const buildApplication = ({ version, applicant, parcels, items }) =>
  compact({
    woodlandName: woodlandName(version.agreementName),
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

  return new Agreement({
    agreementNumber: agreement.agreementNumber,
    version,
    code: sourceVersion.code ?? grant.code,
    clientRef:
      sourceVersion.clientRef ?? grant.clientRef ?? agreement.clientRef,
    configVersion,
    correlationId: sourceVersion.correlationId,
    identifiers: sourceVersion.identifiers,
    schemeCode: sourceVersion.scheme,
    name: sourceVersion.agreementName,
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
    updatedAt: toIsoString(sourceVersion.updatedAt ?? createdAt),
    acceptedAt:
      state === "accepted"
        ? toIsoString(sourceVersion.signatureDate)
        : undefined,
  });
};
/* eslint-enable complexity */

const metadataSchema = Joi.object({
  agreementNumber: Joi.string().pattern(/^WMP/).required(),
  version: Joi.number().integer().min(1).required(),
  code: Joi.string().valid("woodland").required(),
  clientRef: Joi.string().required(),
  configVersion: Joi.string().required(),
  correlationId: Joi.string().required(),
  identifiers: Joi.object({
    sbi: Joi.string().required(),
    frn: Joi.string().required(),
    crn: Joi.string().required(),
    defraId: Joi.string().allow("", null).optional(),
  })
    .unknown(true)
    .required(),
  state: Joi.string()
    .valid(...supportedStates)
    .required(),
  createdAt: Joi.string().isoDate().required(),
  updatedAt: Joi.string().isoDate().required(),
  acceptedAt: Joi.when("state", {
    is: "accepted",
    then: Joi.string().isoDate().required(),
    otherwise: Joi.forbidden(),
  }),
});

const detailsToIssues = (error) =>
  (error?.details ?? []).map((detail) => ({
    path: detail.path.join(".") || "value",
    reason: detail.type,
  }));

const valuesFrom = (agreement) => ({
  schemeCode: agreement.schemeCode,
  name: agreement.name,
  applicant: agreement.applicant,
  application: agreement.application,
  startDate: agreement.startDate,
  endDate: agreement.endDate,
  parcels: agreement.parcels,
  actions: agreement.actions,
  items: agreement.items,
  annualAmountPence: agreement.annualAmountPence,
  totalAmountPence: agreement.totalAmountPence,
  paymentSchedule: agreement.paymentSchedule,
});

const sameValue = (left, right) => left?.toString() === right?.toString();

// Optional legacy payment shapes make this validation exceed the branch limit.
// eslint-disable-next-line complexity
const sourcePaymentIssues = (version) => {
  const payment = version.payment ?? {};
  const totals = [
    payment.annualTotalPence,
    payment.agreementTotalPence,
    payment.payments?.[0]?.totalPaymentPence,
  ].filter((value) => value !== undefined && value !== null);
  const issues = totals.every((value) => sameValue(value, totals[0]))
    ? []
    : [{ path: "payment", reason: "woodland.payment-total.mismatch" }];

  if (
    (payment.payments !== undefined && !Array.isArray(payment.payments)) ||
    payment.payments?.length > 1
  ) {
    issues.push({
      path: "payment.payments",
      reason: "woodland.payment-schedule.unsupported",
    });
  }

  return issues;
};

// Both legacy item representations must agree when they coexist.
// eslint-disable-next-line complexity
const sourceItemIssues = (version) => {
  const paymentItems = entries(version.payment?.agreementLevelItems);
  const applicationItems = version.application?.agreement ?? [];

  if (paymentItems.length === 0 || applicationItems.length === 0) {
    return [];
  }

  const applicationByCode = new Map(
    applicationItems.map((item) => [item.code, item]),
  );
  const sharedFields = ["description", "annualPaymentPence"];
  const consistent =
    paymentItems.length === applicationItems.length &&
    paymentItems.every((item) => {
      const other = applicationByCode.get(item.code);
      return (
        other &&
        sharedFields.every((field) => sameValue(item[field], other[field]))
      );
    });

  return consistent
    ? []
    : [{ path: "items", reason: "woodland.items.source-mismatch" }];
};

const sourceActionIssues = (version, agreement) => {
  const itemCodes = new Set(agreement.items.map(({ code }) => code));
  return sourceParcelActions(version).flatMap(({ action, path }) =>
    itemCodes.has(action.code)
      ? []
      : [{ path, reason: "woodland.action.unmapped" }],
  );
};

// eslint-disable-next-line complexity
const wmpIssues = (agreement) => {
  const issues = [];

  if (agreement.parcels.length === 0) {
    issues.push({ path: "parcels", reason: "woodland.parcels.empty" });
  }
  if (agreement.items.length === 0) {
    issues.push({ path: "items", reason: "woodland.items.empty" });
  }

  agreement.parcels.forEach((parcel, index) => {
    if (Number.isNaN(parcel.area?.quantity)) {
      issues.push({
        path: `parcels.${index}.area.quantity`,
        reason: "woodland.quantity.not-exact",
      });
    }
  });

  agreement.items.forEach((item, index) => {
    const reason = Number.isNaN(item.quantity)
      ? "woodland.quantity.not-exact"
      : "woodland.quantity.unresolved";
    if (item.quantity === undefined || Number.isNaN(item.quantity)) {
      issues.push({ path: `items.${index}.quantity`, reason });
    }
  });

  if (
    agreement.state === "offered" &&
    (agreement.application.hectaresTenOrOverYearsOld === undefined ||
      agreement.application.hectaresUnderTenYearsOld === undefined)
  ) {
    issues.push({
      path: "application",
      reason: "woodland.acceptance-input.unresolved",
    });
  }

  const itemTotal = agreement.items.reduce(
    (total, item) => total + (item.totalAmountPence ?? 0),
    0,
  );
  if (agreement.totalAmountPence !== itemTotal) {
    issues.push({
      path: "totalAmountPence",
      reason: "woodland.payment-total.mismatch",
    });
  }

  return issues;
};

export const validateMappedWoodlandVersion = (agreement, sourceVersion) => {
  const options = {
    abortEarly: false,
    allowUnknown: false,
    convert: false,
  };
  const metadata = metadataSchema.validate(
    {
      agreementNumber: agreement.agreementNumber,
      version: agreement.version,
      code: agreement.code,
      clientRef: agreement.clientRef,
      configVersion: agreement.configVersion,
      correlationId: agreement.correlationId,
      identifiers: agreement.identifiers,
      state: agreement.state,
      createdAt: agreement.createdAt,
      updatedAt: agreement.updatedAt,
      acceptedAt: agreement.acceptedAt,
    },
    options,
  );
  const values = agreementValueSchema.validate(valuesFrom(agreement), options);

  return [
    ...detailsToIssues(metadata.error),
    ...detailsToIssues(values.error),
    ...wmpIssues(agreement),
    ...(sourceVersion ? sourcePaymentIssues(sourceVersion) : []),
    ...(sourceVersion ? sourceItemIssues(sourceVersion) : []),
    ...(sourceVersion ? sourceActionIssues(sourceVersion, agreement) : []),
  ];
};
