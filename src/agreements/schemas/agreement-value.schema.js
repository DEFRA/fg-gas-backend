import Joi from "joi";

export const penceSchema = Joi.number().integer().strict();

export const isCalendarDate = (value) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

export const agreementDateSchema = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((value, helpers) =>
    isCalendarDate(value) ? value : helpers.error("date.calendar"),
  )
  .messages({ "date.calendar": "{{#label}} must be a valid calendar date" });

const parcelAreaSchema = Joi.object({
  quantity: Joi.number().required(),
  unit: Joi.string().required(),
}).label("ParcelArea");

const optionalSourceString = Joi.string().allow("", null).optional();

export const applicantSchema = Joi.object({
  business: Joi.object({
    name: Joi.string().required(),
    address: Joi.object({
      line1: optionalSourceString,
      line2: optionalSourceString,
      line3: optionalSourceString,
      line4: optionalSourceString,
      line5: optionalSourceString,
      street: optionalSourceString,
      city: optionalSourceString,
      postalCode: optionalSourceString,
    }).required(),
  }).required(),
  customer: Joi.object({
    name: Joi.object({
      title: optionalSourceString,
      first: Joi.string().required(),
      middle: optionalSourceString,
      last: Joi.string().required(),
    }).required(),
  }).required(),
}).label("Applicant");

const canonicalParcelId = Joi.string()
  .custom((value, helpers) => {
    const { sheetId, parcelId } = helpers.state.ancestors[0];
    const expected = `${sheetId}-${parcelId}`;

    return value === expected
      ? value
      : helpers.error("parcelId.composite", { expected });
  })
  .messages({
    "parcelId.composite": '{{#label}} must equal "{{#expected}}"',
  });

export const parcelSchema = Joi.object({
  id: canonicalParcelId.required(),
  sheetId: Joi.string().required(),
  parcelId: Joi.string().required(),
  area: parcelAreaSchema.optional(),
}).label("Parcel");

const fundedEntryFields = {
  id: Joi.string().required(),
  code: Joi.string().required(),
  description: Joi.string().optional(),
  version: Joi.string().optional(),
  startDate: agreementDateSchema.optional(),
  endDate: agreementDateSchema.optional(),
  parcel: Joi.string().optional(),
  quantity: Joi.number().optional(),
  unit: Joi.string().optional(),
  ratePence: penceSchema.optional(),
  totalAmountPence: penceSchema.optional(),
};

export const revenueActionSchema = Joi.object({
  ...fundedEntryFields,
  id: Joi.string()
    .pattern(/^action:[1-9]\d*$/)
    .required(),
  durationYears: Joi.number().optional(),
  annualAmountPence: penceSchema.optional(),
})
  .and("quantity", "unit")
  .label("RevenueAction");

export const capitalItemSchema = Joi.object({
  ...fundedEntryFields,
  id: Joi.string()
    .pattern(/^item:[1-9]\d*$/)
    .required(),
})
  .and("quantity", "unit")
  .label("CapitalItem");

// A schedule line may freeze contextual Payment wording that cannot be
// recovered from its funded entry alone. Scheme code is deliberately absent:
// buildPayment derives it from the entry unless configuration fixes one code.
export const paymentScheduleLineItemSchema = Joi.object({
  actionId: Joi.string().optional(),
  itemId: Joi.string().optional(),
  amountPence: penceSchema.required(),
  description: Joi.string().optional(),
})
  .xor("actionId", "itemId")
  .messages({
    "object.missing":
      "{{#label}} must contain exclusively one of [actionId, itemId]",
    "object.xor":
      "{{#label}} must contain exclusively one of [actionId, itemId]",
  })
  .label("PaymentScheduleLineItem");

const validateInstalmentTotal = (value, helpers) => {
  const lineItemsTotal = value.lineItems.reduce(
    (total, lineItem) => total + BigInt(lineItem.amountPence),
    0n,
  );

  return BigInt(value.totalAmountPence) === lineItemsTotal
    ? value
    : helpers.error("instalment.lineItemsTotal");
};

const paymentScheduleInstalmentSchema = Joi.object({
  id: Joi.string().required(),
  dueDate: agreementDateSchema.required(),
  totalAmountPence: penceSchema.required(),
  correlationId: Joi.string().optional(),
  lineItems: Joi.array().items(paymentScheduleLineItemSchema).required(),
})
  .custom(validateInstalmentTotal)
  .messages({
    "instalment.lineItemsTotal":
      "{{#label}} totalAmountPence must equal the sum of lineItems amountPence",
  })
  .label("PaymentScheduleInstalment");

const paymentScheduleSchema = Joi.object({
  frequency: Joi.string().optional(),
  instalments: Joi.array()
    .items(paymentScheduleInstalmentSchema)
    .unique("id")
    .required(),
}).label("PaymentSchedule");

const toFundedEntries = ({ actions, items }) => [
  ...actions.map((entry, index) => ({ entry, path: `actions[${index}]` })),
  ...items.map((entry, index) => ({ entry, path: `items[${index}]` })),
];

const hasInvertedRange = ({ startDate, endDate }) =>
  Boolean(startDate && endDate && startDate > endDate);

const findOutOfBoundsEntryDate = (entries, agreement) =>
  entries
    .flatMap(({ entry, path }) =>
      ["startDate", "endDate"].map((field) => ({
        date: entry[field],
        field,
        path,
      })),
    )
    .find(
      ({ date }) =>
        date < (agreement.startDate ?? date) ||
        date > (agreement.endDate ?? date),
    );

const findDateViolation = (agreement) => {
  if (hasInvertedRange(agreement)) {
    return { code: "agreement.dateRange" };
  }

  const entries = toFundedEntries(agreement);
  const invertedEntry = entries.find(({ entry }) => hasInvertedRange(entry));

  if (invertedEntry) {
    return { code: "entry.dateRange", path: invertedEntry.path };
  }

  const outOfBounds = findOutOfBoundsEntryDate(entries, agreement);

  return (
    outOfBounds && {
      code: "entry.dateBounds",
      path: outOfBounds.path,
      field: outOfBounds.field,
    }
  );
};

// Add a validator here only when another compatible area unit is evidenced.
// Unit conversion stays behind this seam rather than leaking into entries.
const areaQuantityValidators = {
  ha: (entry, parcel) =>
    parcel?.area?.unit === "ha" && entry.quantity > parcel.area.quantity,
};

const findParcelViolation = (agreement) => {
  const parcelsById = new Map(
    (agreement.parcels ?? []).map((parcel) => [parcel.id, parcel]),
  );
  const entries = toFundedEntries(agreement);
  const danglingReference = entries.find(
    ({ entry }) => entry.parcel && !parcelsById.has(entry.parcel),
  );

  if (danglingReference) {
    return {
      code: "entry.parcelReference",
      path: danglingReference.path,
      parcel: danglingReference.entry.parcel,
    };
  }

  const overArea = entries.find(({ entry }) =>
    areaQuantityValidators[entry.unit]?.(entry, parcelsById.get(entry.parcel)),
  );

  return (
    overArea && {
      code: "entry.parcelArea",
      path: overArea.path,
      parcel: overArea.entry.parcel,
    }
  );
};

const findLineItemReferenceViolation = ({
  actions,
  items,
  paymentSchedule,
}) => {
  const referencedIds = {
    actionId: new Set(actions.map(({ id }) => id)),
    itemId: new Set(items.map(({ id }) => id)),
  };
  const references = (paymentSchedule?.instalments ?? []).flatMap(
    (instalment, instalmentIndex) =>
      instalment.lineItems.flatMap((lineItem, lineItemIndex) =>
        Object.entries(referencedIds).map(([field, ids]) => ({
          field,
          ids,
          reference: lineItem[field],
          path: `paymentSchedule.instalments[${instalmentIndex}].lineItems[${lineItemIndex}]`,
        })),
      ),
  );
  const dangling = references.find(
    ({ ids, reference }) => reference && !ids.has(reference),
  );

  return (
    dangling && {
      code: "lineItem.reference",
      field: dangling.field,
      path: dangling.path,
      reference: dangling.reference,
    }
  );
};

const validateAgreementInvariants = (value, helpers) => {
  const violation =
    findDateViolation(value) ??
    findParcelViolation(value) ??
    findLineItemReferenceViolation(value);

  return violation ? helpers.error(violation.code, violation) : value;
};

export const agreementValueSchema = Joi.object({
  schemeCode: Joi.string().optional(),
  name: Joi.string().optional(),
  applicant: applicantSchema.optional(),
  application: Joi.object().unknown(true).required(),
  startDate: agreementDateSchema.optional(),
  endDate: agreementDateSchema.optional(),
  parcels: Joi.array().items(parcelSchema).unique("id").optional(),
  actions: Joi.array().items(revenueActionSchema).unique("id").required(),
  items: Joi.array().items(capitalItemSchema).unique("id").required(),
  annualAmountPence: penceSchema.optional(),
  totalAmountPence: penceSchema.optional(),
  paymentSchedule: paymentScheduleSchema.optional(),
})
  .custom(validateAgreementInvariants)
  .messages({
    "agreement.dateRange": "Agreement startDate must be on or before endDate",
    "entry.dateRange": "{{#path}} startDate must be on or before endDate",
    "entry.dateBounds":
      "{{#path}}.{{#field}} must be within the Agreement date range",
    "entry.parcelReference":
      '{{#path}}.parcel references unknown Parcel "{{#parcel}}"',
    "entry.parcelArea":
      '{{#path}}.quantity must not exceed Parcel "{{#parcel}}" area',
    "lineItem.reference":
      '{{#path}} line item {{#field}} references unknown entry "{{#reference}}"',
  })
  .label("AgreementValue");
