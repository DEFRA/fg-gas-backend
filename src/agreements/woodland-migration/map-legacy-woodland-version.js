import Joi from "joi";
import { Agreement } from "../models/agreement.js";
import { agreementValueSchema } from "../schemas/agreement-value.schema.js";

const supportedStates = ["offered", "accepted"];
const supportedItemUnits = new Set(["ha", "%"]);

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

const keyedEntries = (value) =>
  value instanceof Map ? [...value.entries()] : Object.entries(value ?? {});

const entries = (value) => keyedEntries(value).map(([, entry]) => entry);

const isKeyedCollection = (value) =>
  value instanceof Map ||
  (value !== null && typeof value === "object" && !Array.isArray(value));

const paymentItemEntries = (version) =>
  keyedEntries(version.payment?.agreementLevelItems);

const applicationItemEntries = (version) =>
  (version.application?.agreement ?? []).map((item, index) => [
    String(index + 1),
    item,
  ]);

const sourceItemEntries = (version) => {
  const paymentItems = paymentItemEntries(version);
  return paymentItems.length > 0
    ? paymentItems
    : applicationItemEntries(version);
};

const sourceItems = (version) =>
  sourceItemEntries(version).map(([, item]) => item);

const sourceActionApplications = (version) =>
  (version.actionApplications ?? []).map((action, index) => ({
    action,
    path: `actionApplications.${index}`,
  }));

const sourceApplicationParcelActions = (version) =>
  (version.application?.parcel ?? []).flatMap((parcel, parcelIndex) =>
    (parcel.actions ?? []).map((action, actionIndex) => ({
      action,
      path: `application.parcel.${parcelIndex}.actions.${actionIndex}`,
    })),
  );

const sourceActions = (version) => [
  ...sourceActionApplications(version),
  ...sourceApplicationParcelActions(version),
];

// Current producer parcel actions carry agreement-item values, whereas
// actionApplications carry parcel areas. Older records may only have the latter.
const matchingItemActions = (version, item) => {
  const parcelActions = sourceApplicationParcelActions(version).filter(
    ({ action }) => action.code === item.code,
  );
  return parcelActions.length > 0
    ? parcelActions
    : sourceActionApplications(version).filter(
        ({ action }) => action.code === item.code,
      );
};

const matchingActionValues = (version, item, field) => [
  ...new Set(
    matchingItemActions(version, item)
      .map(({ action }) => action.appliedFor?.[field])
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
    unit: quantity === undefined ? undefined : unit,
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

const validPence = (value) => Number.isSafeInteger(value) && value >= 0;

const singlePayment = (payment) => {
  if (!Array.isArray(payment.payments) || payment.payments.length !== 1) {
    return undefined;
  }
  return payment.payments[0];
};

const paymentLineItems = (payment) =>
  Array.isArray(payment?.lineItems) ? payment.lineItems : [];

const sourceItemAmountEntries = (version) =>
  sourceItemEntries(version).map(([id, item]) => [
    `items.${id}.totalAmountPence`,
    item.agreementTotalPence ?? item.annualPaymentPence,
  ]);

const sourcePaymentAmountEntries = (version) => {
  const payment = version.payment ?? {};
  const sourcePayment = singlePayment(payment);
  const amounts = [
    ["payment.annualTotalPence", payment.annualTotalPence],
    ["payment.agreementTotalPence", payment.agreementTotalPence],
    ...sourceItemAmountEntries(version),
  ];

  if (sourcePayment) {
    amounts.push(
      ["payment.payments.0.totalPaymentPence", sourcePayment.totalPaymentPence],
      ...paymentLineItems(sourcePayment).map((lineItem, index) => [
        `payment.payments.0.lineItems.${index}.paymentPence`,
        lineItem.paymentPence,
      ]),
    );
  }

  return amounts;
};

const sourcePaymentAmountIssues = (version) =>
  sourcePaymentAmountEntries(version).flatMap(([path, value]) =>
    validPence(value)
      ? []
      : [{ path, reason: "woodland.payment-amount.invalid" }],
  );

const unresolvedLineIssue = (path) => ({
  path,
  reason: "woodland.payment-line-item.unresolved",
});

const sourceItemAmount = (item) =>
  item.agreementTotalPence ?? item.annualPaymentPence;

const unresolvedPaymentLine = (lineItem, itemId, item, referencedIds) =>
  !item || referencedIds.has(itemId) || lineItem.parcelItemId !== undefined;

const paymentLineIssues = ({ lineItem, index, itemsById, referencedIds }) => {
  const path = `payment.payments.0.lineItems.${index}`;
  const itemId = String(lineItem.agreementLevelItemId);
  const item = itemsById.get(itemId);

  if (unresolvedPaymentLine(lineItem, itemId, item, referencedIds)) {
    return [unresolvedLineIssue(path)];
  }

  referencedIds.add(itemId);
  return sameValue(lineItem.paymentPence, sourceItemAmount(item))
    ? []
    : [
        {
          path: `${path}.paymentPence`,
          reason: "woodland.payment-line-item.amount-mismatch",
        },
      ];
};

const sourcePaymentFor = (version) => singlePayment(version.payment ?? {});

const sourcePaymentLineIssues = (version) => {
  const sourcePayment = sourcePaymentFor(version);
  if (!sourcePayment) {
    return [];
  }
  if (!Array.isArray(sourcePayment.lineItems)) {
    return [unresolvedLineIssue("payment.payments.0.lineItems")];
  }

  const itemsById = new Map(
    sourceItemEntries(version).map(([id, item]) => [String(id), item]),
  );
  const referencedIds = new Set();
  const issues = sourcePayment.lineItems.flatMap((lineItem, index) =>
    paymentLineIssues({ lineItem, index, itemsById, referencedIds }),
  );

  if (referencedIds.size !== itemsById.size) {
    issues.push(unresolvedLineIssue("payment.payments.0.lineItems"));
  }

  return issues;
};

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

  if (payment.frequency !== "OneOff") {
    issues.push({
      path: "payment.frequency",
      reason: "woodland.payment-frequency.unsupported",
    });
  }

  if (
    !isKeyedCollection(payment.parcelItems) ||
    entries(payment.parcelItems).length > 0
  ) {
    issues.push({
      path: "payment.parcelItems",
      reason: "woodland.parcel-items.unsupported",
    });
  }

  if (!Array.isArray(payment.payments) || payment.payments.length !== 1) {
    issues.push({
      path: "payment.payments",
      reason: "woodland.payment-schedule.unsupported",
    });
  }

  const lineItems = payment.payments?.[0]?.lineItems;
  if (
    Array.isArray(lineItems) &&
    lineItems.every(({ paymentPence }) => Number.isSafeInteger(paymentPence))
  ) {
    const lineTotal = lineItems.reduce(
      (total, { paymentPence }) => total + BigInt(paymentPence),
      0n,
    );
    if (
      lineTotal.toString() !==
        payment.payments[0].totalPaymentPence?.toString() &&
      !issues.some(({ path }) => path === "payment")
    ) {
      issues.push({
        path: "payment",
        reason: "woodland.payment-total.mismatch",
      });
    }
  }

  issues.push(
    ...sourcePaymentAmountIssues(version),
    ...sourcePaymentLineIssues(version),
  );
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

const sourceActionCodeIssues = (version, agreement) => {
  const itemCodes = new Set(agreement.items.map(({ code }) => code));
  return sourceActions(version).flatMap(({ action, path }) =>
    itemCodes.has(action.code)
      ? []
      : [{ path, reason: "woodland.action.unmapped" }],
  );
};

const actionReferencesParcel = (action, parcel) =>
  [parcel.sheetId, parcel.id].includes(action.sheetId) &&
  [parcel.parcelId, parcel.id].includes(action.parcelId);

const sourceActionParcelIssues = (version, agreement) =>
  sourceActionApplications(version).flatMap(({ action, path }) =>
    agreement.parcels.some((parcel) => actionReferencesParcel(action, parcel))
      ? []
      : [{ path, reason: "woodland.action.parcel-unresolved" }],
  );

const sourceActionIssues = (version, agreement) => [
  ...sourceActionCodeIssues(version, agreement),
  ...sourceActionParcelIssues(version, agreement),
];

const acceptedAgreementDateIssues = (agreement) =>
  agreement.state === "accepted"
    ? ["startDate", "endDate"].flatMap((path) =>
        agreement[path] === undefined
          ? [{ path, reason: "woodland.agreement-date.unresolved" }]
          : [],
      )
    : [];

const invalidParcelQuantity = (quantity) =>
  !Number.isFinite(quantity) || quantity <= 0;
const invalidItemQuantity = (quantity) =>
  !Number.isFinite(quantity) || quantity < 0;

const quantityIssues = (quantity, path, invalid) => {
  if (quantity === undefined) {
    return [{ path, reason: "woodland.quantity.unresolved" }];
  }
  if (Number.isNaN(quantity)) {
    return [{ path, reason: "woodland.quantity.not-exact" }];
  }
  if (invalid(quantity)) {
    return [{ path, reason: "woodland.quantity.invalid" }];
  }
  return [];
};

const parcelIssues = (parcel, index) => {
  const area = parcel.area ?? {};
  return [
    ...quantityIssues(
      area.quantity,
      `parcels.${index}.area.quantity`,
      invalidParcelQuantity,
    ),
    ...(area.unit === "ha"
      ? []
      : [
          {
            path: `parcels.${index}.area.unit`,
            reason: "woodland.unit.unsupported",
          },
        ]),
  ];
};

const itemIssues = (item, index) => [
  ...quantityIssues(
    item.quantity,
    `items.${index}.quantity`,
    invalidItemQuantity,
  ),
  ...(supportedItemUnits.has(item.unit)
    ? []
    : [
        {
          path: `items.${index}.unit`,
          reason: "woodland.unit.unsupported",
        },
      ]),
];

// eslint-disable-next-line complexity
const wmpIssues = (agreement) => {
  const issues = [
    ...acceptedAgreementDateIssues(agreement),
    ...agreement.parcels.flatMap(parcelIssues),
    ...agreement.items.flatMap(itemIssues),
  ];

  if (agreement.parcels.length === 0) {
    issues.push({ path: "parcels", reason: "woodland.parcels.empty" });
  }
  if (agreement.items.length === 0) {
    issues.push({ path: "items", reason: "woodland.items.empty" });
  }

  const schemeAreas = [
    agreement.application.hectaresTenOrOverYearsOld,
    agreement.application.hectaresUnderTenYearsOld,
  ];
  if (schemeAreas.some((value) => value === undefined)) {
    issues.push({
      path: "application",
      reason: "woodland.acceptance-input.unresolved",
    });
  }
  if (
    schemeAreas.some(
      (value) => value !== undefined && (!Number.isFinite(value) || value < 0),
    )
  ) {
    issues.push({
      path: "application",
      reason: "woodland.acceptance-input.invalid",
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
