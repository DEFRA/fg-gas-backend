import Boom from "@hapi/boom";
import Joi from "joi";
import { randomUUID } from "node:crypto";

const invoiceLineSchema = Joi.object({
  schemeCode: Joi.string().required(),
  description: Joi.string().required(),
  amountPence: Joi.number().integer().required(),
  accountCode: Joi.string().required(),
  fundCode: Joi.string().required(),
  deliveryBody: Joi.string().required(),
  marketingYear: Joi.string().required(),
});

const paymentSchema = Joi.object({
  dueDate: Joi.string().required(),
  totalAmountPence: Joi.number().integer().required(),
  status: Joi.string().required(),
  correlationId: Joi.string().required(),
  invoiceLines: Joi.array().items(invoiceLineSchema).min(1).required(),
});

const balancesWithInvoiceLines = (payments, helpers) => {
  const unbalanced = payments.find(
    ({ totalAmountPence, invoiceLines }) =>
      totalAmountPence !==
      invoiceLines.reduce((total, line) => total + line.amountPence, 0),
  );

  return unbalanced
    ? helpers.message({
        custom: `payment due ${unbalanced.dueDate} does not balance with its invoice lines`,
      })
    : payments;
};

const deepFreeze = (value) => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }

  return value;
};

export const PayableSourceType = {
  AGREEMENT: "agreement",
};

export const PaymentStatus = {
  PENDING: "pending",
};

/**
 * An immutable record of an amount owed against an accepted Agreement Version.
 *
 * A Payable carries everything needed to build the Payment Service message, so
 * publication never has to load the Agreement or its definition. Monetary
 * values stay numeric here and are only stringified at the legacy message
 * boundary.
 */
export class Payable {
  static validationSchema = Joi.object({
    id: Joi.string().required(),
    source: Joi.object({
      type: Joi.string()
        .valid(...Object.values(PayableSourceType))
        .required(),
      agreementNumber: Joi.string().required(),
      version: Joi.number().integer().min(1).required(),
    }).required(),
    sbi: Joi.string().required(),
    frn: Joi.string().required(),
    paymentHubClaimId: Joi.string().required(),
    scheme: Joi.string().required(),
    sourceSystem: Joi.string().required(),
    deliveryBody: Joi.string().required(),
    fesCode: Joi.string().required(),
    paymentRequestNumber: Joi.number().integer().min(1).required(),
    correlationId: Joi.string().required(),
    invoiceNumber: Joi.string().required(),
    originalInvoiceNumber: Joi.string().allow("").required(),
    ledger: Joi.string().required(),
    totalAmountPence: Joi.number().integer().required(),
    currency: Joi.string().required(),
    marketingYear: Joi.string().required(),
    payments: Joi.array()
      .items(paymentSchema)
      .min(1)
      .custom(balancesWithInvoiceLines)
      .required(),
    createdAt: Joi.string().required(),
  }).custom((payable, helpers) => {
    const paymentTotal = payable.payments.reduce(
      (total, payment) => total + payment.totalAmountPence,
      0,
    );

    return paymentTotal === payable.totalAmountPence
      ? payable
      : helpers.message({
          custom: "totalAmountPence does not balance with its payments",
        });
  });

  constructor(props) {
    const { error, value } = Payable.validationSchema.validate(props, {
      stripUnknown: true,
      abortEarly: false,
    });

    if (error) {
      throw Boom.badRequest(
        `Invalid Payable: ${error.details.map((detail) => detail.message).join(", ")}`,
      );
    }

    Object.assign(this, structuredClone(value));
    deepFreeze(this);
  }

  static create({
    id = randomUUID(),
    correlationId = randomUUID(),
    createdAt = new Date().toISOString(),
    ...props
  }) {
    return new Payable({ ...props, id, correlationId, createdAt });
  }
}
