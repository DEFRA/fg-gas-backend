import Joi from "joi";
import {
  agreementValueSchema,
  isCalendarDate,
} from "../schemas/agreement-value.schema.js";
import {
  entries,
  isKeyedCollection,
  sourceActionApplications,
  sourceActions,
  sourceApplicationParcelActions,
  sourceItemActionValues,
  sourceItemEntries,
  toExactNumber,
} from "./woodland-migration-source-values.js";

const supportedStates = ["offered", "accepted"];
const supportedItemUnits = new Set(["ha", "%"]);
const PAYMENT_TOTAL_MISMATCH = "woodland.payment-total.mismatch";

const timestampSchema = Joi.string()
  .isoDate()
  .custom((value, helpers) =>
    isCalendarDate(value.slice(0, 10)) ? value : helpers.error("date.calendar"),
  );

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
  schemeCode: Joi.string().required(),
  name: Joi.string().required(),
  state: Joi.string()
    .valid(...supportedStates)
    .required(),
  createdAt: timestampSchema.required(),
  updatedAt: timestampSchema.required(),
  acceptedAt: Joi.when("state", {
    is: "accepted",
    then: timestampSchema.required(),
    otherwise: Joi.forbidden(),
  }),
  versionedAt: timestampSchema.required(),
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

const presentValues = (values) =>
  values.filter((value) => value !== undefined && value !== null);

const hasConflictingValues = (
  values,
  normalise = (value) => value.toString(),
) => new Set(presentValues(values).map(normalise)).size > 1;

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

const sourceItemPaymentAmountIssues = (version) =>
  sourceItemEntries(version).flatMap(([id, item]) =>
    hasConflictingValues([item.agreementTotalPence, item.annualPaymentPence])
      ? [
          {
            path: `items.${id}.totalAmountPence`,
            reason: "woodland.item-payment-amount.source-mismatch",
          },
        ]
      : [],
  );

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

const paymentTotalIssue = () => ({
  path: "payment",
  reason: PAYMENT_TOTAL_MISMATCH,
});

const sourcePaymentTotalIssues = (payment) => {
  const totals = [
    payment.annualTotalPence,
    payment.agreementTotalPence,
    payment.payments?.[0]?.totalPaymentPence,
  ].filter((value) => value !== undefined && value !== null);

  return totals.every((value) => sameValue(value, totals[0]))
    ? []
    : [paymentTotalIssue()];
};

const sourcePaymentFrequencyIssues = (payment) =>
  payment.frequency === "OneOff"
    ? []
    : [
        {
          path: "payment.frequency",
          reason: "woodland.payment-frequency.unsupported",
        },
      ];

const sourceParcelItemIssues = (payment) =>
  isKeyedCollection(payment.parcelItems) &&
  entries(payment.parcelItems).length === 0
    ? []
    : [
        {
          path: "payment.parcelItems",
          reason: "woodland.parcel-items.unsupported",
        },
      ];

const sourcePaymentScheduleIssues = (payment) =>
  Array.isArray(payment.payments) && payment.payments.length === 1
    ? []
    : [
        {
          path: "payment.payments",
          reason: "woodland.payment-schedule.unsupported",
        },
      ];

const sourcePaymentLineItems = (payment) => payment.payments?.[0]?.lineItems;

const hasSafePaymentAmounts = (lineItems) =>
  Array.isArray(lineItems) &&
  lineItems.every(({ paymentPence }) => Number.isSafeInteger(paymentPence));

const sourcePaymentLineTotalIssues = (payment) => {
  const lineItems = sourcePaymentLineItems(payment);
  if (!hasSafePaymentAmounts(lineItems)) {
    return [];
  }

  const lineTotal = lineItems.reduce(
    (total, { paymentPence }) => total + BigInt(paymentPence),
    0n,
  );
  return sameValue(lineTotal, payment.payments[0].totalPaymentPence)
    ? []
    : [paymentTotalIssue()];
};

const sourcePaymentIssues = (version) => {
  const payment = version.payment ?? {};
  const totalIssues = sourcePaymentTotalIssues(payment);
  const lineTotalIssues =
    totalIssues.length === 0 ? sourcePaymentLineTotalIssues(payment) : [];

  return [
    ...totalIssues,
    ...sourcePaymentFrequencyIssues(payment),
    ...sourceParcelItemIssues(payment),
    ...sourcePaymentScheduleIssues(payment),
    ...lineTotalIssues,
    ...sourcePaymentAmountIssues(version),
    ...sourcePaymentLineIssues(version),
  ];
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

const sourceItemActionValueIssues = (version) =>
  sourceItemEntries(version).flatMap(([id, item]) =>
    ["quantity", "unit"].flatMap((field) => {
      const values = [
        item[field],
        ...sourceItemActionValues(version, item, field),
      ];
      const normalise =
        field === "quantity" ? toExactNumber : (value) => value.toString();

      return hasConflictingValues(values, normalise)
        ? [
            {
              path: `items.${id}.${field}`,
              reason: `woodland.item-${field}.source-mismatch`,
            },
          ]
        : [];
    }),
  );

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

const actionParcelValueIssues = (action, parcel, path) =>
  ["quantity", "unit"].flatMap((field) =>
    sameValue(action.appliedFor?.[field], parcel.area?.[field])
      ? []
      : [
          {
            path: `${path}.appliedFor.${field}`,
            reason: `woodland.action.parcel-${field}-mismatch`,
          },
        ],
  );

const sourceActionParcelIssues = (version, agreement) => {
  const compareParcelValues =
    sourceApplicationParcelActions(version).length > 0;

  return sourceActionApplications(version).flatMap(({ action, path }) => {
    const parcel = agreement.parcels.find((candidate) =>
      actionReferencesParcel(action, candidate),
    );

    if (!parcel) {
      return [{ path, reason: "woodland.action.parcel-unresolved" }];
    }

    return compareParcelValues
      ? actionParcelValueIssues(action, parcel, path)
      : [];
  });
};

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
  if (schemeAreas.includes(undefined)) {
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
      reason: PAYMENT_TOTAL_MISMATCH,
    });
  }

  return issues;
};

const sourceVersionIssues = (sourceVersion, agreement) => {
  if (!sourceVersion) {
    return [];
  }

  return [
    ...sourcePaymentIssues(sourceVersion),
    ...sourceItemPaymentAmountIssues(sourceVersion),
    ...sourceItemIssues(sourceVersion),
    ...sourceItemActionValueIssues(sourceVersion),
    ...sourceActionIssues(sourceVersion, agreement),
  ];
};

export const validateMappedWoodlandVersion = (
  agreementVersion,
  sourceVersion,
) => {
  const agreement = agreementVersion.snapshot;
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
      schemeCode: agreement.schemeCode,
      name: agreement.name,
      state: agreement.state,
      createdAt: agreement.createdAt,
      updatedAt: agreement.updatedAt,
      acceptedAt: agreement.acceptedAt,
      versionedAt: agreementVersion.versionedAt,
    },
    options,
  );
  const values = agreementValueSchema.validate(valuesFrom(agreement), options);

  return [
    ...detailsToIssues(metadata.error),
    ...detailsToIssues(values.error),
    ...wmpIssues(agreement),
    ...sourceVersionIssues(sourceVersion, agreement),
  ];
};
