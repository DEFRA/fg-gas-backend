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

const duePaymentSchema = Joi.object({
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

export const PaymentSourceType = {
  AGREEMENT: "agreement",
  CLAIM: "claim",
};

// Each source identifies the record the Payment was raised from by that
// record's own key. The Agreement version a Claim carries is point-in-time: the
// current Agreement's moves on as amendments land, so nothing read later can
// recover which one was in force when this was paid.
const agreementSourceSchema = Joi.object({
  type: Joi.string().valid(PaymentSourceType.AGREEMENT).required(),
  agreementNumber: Joi.string().required(),
  version: Joi.number().integer().min(1).required(),
});

const claimSourceSchema = Joi.object({
  type: Joi.string().valid(PaymentSourceType.CLAIM).required(),
  code: Joi.string().required(),
  clientRef: Joi.string().required(),
  clientClaimRef: Joi.string().required(),
  entitlementId: Joi.string().required(),
  // Not the Claim's identity: the Agreement it is reported against, kept here
  // because the message is built from the Payment alone.
  agreementNumber: Joi.string().required(),
  agreementVersion: Joi.number().integer().min(1).required(),
});

const sourceSchema = Joi.alternatives()
  .conditional(".type", {
    switch: [
      { is: PaymentSourceType.AGREEMENT, then: agreementSourceSchema },
      { is: PaymentSourceType.CLAIM, then: claimSourceSchema },
    ],
    otherwise: Joi.object({
      type: Joi.string()
        .valid(...Object.values(PaymentSourceType))
        .required(),
    }).unknown(true),
  })
  .required();

export const DuePaymentStatus = {
  PENDING: "pending",
};

/**
 * An immutable record of an amount owed against the record that raised it — an
 * accepted Agreement Version, or a submitted Claim — split into the payments
 * that fall due.
 *
 * The nested `payments` field keeps the Payment Service/domain boundary used by
 * the legacy Agreements API. Agreement Payment Schedule Instalments are mapped
 * into this shape once, when the immutable Payment is created.
 *
 * A Payment carries everything needed to build the Payment Service message, so
 * publication never has to load the Agreement or its definition. Monetary
 * values stay numeric here and are only stringified at the legacy message
 * boundary.
 */
export class Payment {
  static validationSchema = Joi.object({
    id: Joi.string().required(),
    source: sourceSchema,
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
      .items(duePaymentSchema)
      .min(1)
      .custom(balancesWithInvoiceLines)
      .required(),
    createdAt: Joi.string().required(),
  }).custom((payment, helpers) => {
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

    this.id = value.id;
    this.source = structuredClone(value.source);
    this.sbi = value.sbi;
    this.frn = value.frn;
    this.paymentHubClaimId = value.paymentHubClaimId;
    this.scheme = value.scheme;
    this.sourceSystem = value.sourceSystem;
    this.deliveryBody = value.deliveryBody;
    this.fesCode = value.fesCode;
    this.paymentRequestNumber = value.paymentRequestNumber;
    this.correlationId = value.correlationId;
    this.invoiceNumber = value.invoiceNumber;
    this.originalInvoiceNumber = value.originalInvoiceNumber;
    this.ledger = value.ledger;
    this.totalAmountPence = value.totalAmountPence;
    this.currency = value.currency;
    this.marketingYear = value.marketingYear;
    this.payments = structuredClone(value.payments);
    this.createdAt = value.createdAt;

    deepFreeze(this);
  }

  static create({
    id = randomUUID(),
    correlationId = randomUUID(),
    createdAt = new Date().toISOString(),
    ...props
  }) {
    return new Payment({ ...props, id, correlationId, createdAt });
  }
}
