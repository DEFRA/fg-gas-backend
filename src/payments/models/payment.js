import Boom from "@hapi/boom";
import Joi from "joi";
import { randomUUID } from "node:crypto";
import { formatInvoiceNumber } from "./claim-id.js";

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

const invoiceLineSchema = Joi.object({
  schemeCode: Joi.string().required(),
  description: Joi.string().required(),
  amountPence: Joi.number().integer().required(),
  accountCode: Joi.string().required(),
  fundCode: Joi.string().required(),
  deliveryBody: Joi.string().required(),
  marketingYear: Joi.string().required(),
});

const duePaymentBusinessFieldsSchema = Joi.object({
  dueDate: Joi.string().required(),
  totalAmountPence: Joi.number().integer().required(),
  invoiceLines: Joi.array().items(invoiceLineSchema).min(1).required(),
});

const duePaymentSchema = duePaymentBusinessFieldsSchema.keys({
  status: Joi.string().required(),
  correlationId: Joi.string().required(),
});

export const paymentBusinessFieldsSchema = Joi.object({
  sbi: Joi.string().required(),
  frn: Joi.string().required(),
  scheme: Joi.string().required(),
  sourceSystem: Joi.string().required(),
  deliveryBody: Joi.string().required(),
  fesCode: Joi.string().required(),
  originalInvoiceNumber: Joi.string().allow("").required(),
  ledger: Joi.string().required(),
  totalAmountPence: Joi.number().integer().required(),
  currency: Joi.string().required(),
  marketingYear: Joi.string().required(),
  payments: Joi.array()
    .items(duePaymentBusinessFieldsSchema)
    .min(1)
    .custom(balancesWithInvoiceLines)
    .required(),
});

const deepFreeze = (value) => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }

  return value;
};

const PaymentSourceType = {
  AGREEMENT: "agreement",
};

const DuePaymentStatus = {
  PENDING: "pending",
};

const PAYMENT_REQUEST_NUMBER = 1;

const requireConfiguration = (paymentConfiguration) => {
  if (!paymentConfiguration) {
    throw Boom.badImplementation(
      "A Payment requires a resolved Payment Definition",
    );
  }

  return paymentConfiguration;
};

const requireAgreementCorrelationId = (agreementCorrelationId) => {
  if (!agreementCorrelationId) {
    throw Boom.badImplementation(
      "A Payment requires the Agreement Correlation ID",
    );
  }

  return agreementCorrelationId;
};

const addPlatformFields = (duePayment) => ({
  ...duePayment,
  status: DuePaymentStatus.PENDING,
  correlationId: randomUUID(),
});

/**
 * An immutable record of an amount owed against an accepted Agreement Version,
 * split into the payments that fall due over the Agreement's term.
 *
 * The nested `payments` field keeps the Payment Service/domain boundary used by
 * the legacy Agreements API. A Payment Definition maps source context into this
 * shape before the immutable Payment is created.
 *
 * A Payment carries everything needed to build the Payment Service message, so
 * publication never has to load the Agreement or its definition. Monetary
 * values stay numeric here and are only stringified at the legacy message
 * boundary.
 */
export class Payment {
  static validationSchema = paymentBusinessFieldsSchema
    .keys({
      id: Joi.string().required(),
      source: Joi.object({
        type: Joi.string()
          .valid(...Object.values(PaymentSourceType))
          .required(),
        agreementNumber: Joi.string().required(),
        version: Joi.number().integer().min(1).required(),
      }).required(),
      paymentHubClaimId: Joi.string().required(),
      paymentRequestNumber: Joi.number().integer().min(1).required(),
      correlationId: Joi.string().required(),
      invoiceNumber: Joi.string().required(),
      payments: Joi.array()
        .items(duePaymentSchema)
        .min(1)
        .custom(balancesWithInvoiceLines)
        .required(),
      createdAt: Joi.string().required(),
    })
    .custom((payment, helpers) => {
      const duePaymentTotal = payment.payments.reduce(
        (total, due) => total + due.totalAmountPence,
        0,
      );

      return duePaymentTotal === payment.totalAmountPence
        ? payment
        : helpers.message({
            custom: "totalAmountPence does not balance with its payments",
          });
    });

  constructor(props) {
    const { error, value } = Payment.validationSchema.validate(props, {
      stripUnknown: true,
      abortEarly: false,
    });

    if (error) {
      throw Boom.badRequest(
        `Invalid Payment: ${error.details.map((detail) => detail.message).join(", ")}`,
      );
    }

    Object.assign(this, structuredClone(value));
    deepFreeze(this);
  }

  /**
   * The only way to mint a Payment for an accepted Agreement Version.
   *
   * Takes the business fields a Payment Definition resolved and adds the fields
   * that are code-owned and never configurable: identity, source, statuses,
   * request and invoice numbering, correlation IDs and timestamps. Keeping that
   * split here rather than in a caller means configuration cannot reach a
   * platform field by any route.
   */
  static forAgreement({
    agreementNumber,
    version,
    agreementCorrelationId,
    paymentConfiguration,
    paymentHubClaimId,
    createdAt = new Date().toISOString(),
    id = randomUUID(),
  }) {
    const configuration = requireConfiguration(paymentConfiguration);

    return new Payment({
      ...configuration,
      id,
      source: {
        type: PaymentSourceType.AGREEMENT,
        agreementNumber,
        version,
      },
      paymentHubClaimId,
      paymentRequestNumber: PAYMENT_REQUEST_NUMBER,
      correlationId: requireAgreementCorrelationId(agreementCorrelationId),
      invoiceNumber: formatInvoiceNumber(
        paymentHubClaimId,
        PAYMENT_REQUEST_NUMBER,
      ),
      payments: configuration.payments.map(addPlatformFields),
      createdAt,
    });
  }
}
