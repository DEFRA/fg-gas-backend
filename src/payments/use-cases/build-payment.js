import Boom from "@hapi/boom";
import Joi from "joi";
import { randomUUID } from "node:crypto";
import {
  DuePaymentStatus,
  Payment,
  PaymentSourceType,
} from "../models/payment.js";
import { formatInvoiceNumber } from "../services/claim-id.js";

const PAYMENT_REQUEST_NUMBER = 1;

const paymentScheduleLineItemSchema = Joi.object({
  actionId: Joi.string().optional(),
  itemId: Joi.string().optional(),
  amountPence: Joi.number().integer().strict().required(),
  description: Joi.string().optional(),
}).xor("actionId", "itemId");

const requirePaymentConfiguration = (paymentConfiguration) => {
  if (!paymentConfiguration) {
    throw Boom.badImplementation(
      "createPayment requires payment configuration from the Agreement Definition",
    );
  }

  return paymentConfiguration;
};

const requireAgreementCorrelationId = (agreementCorrelationId) => {
  if (!agreementCorrelationId) {
    throw Boom.badImplementation(
      "createPayment requires the Agreement Correlation ID",
    );
  }

  return agreementCorrelationId;
};

const requireInstalments = (agreementValues) => {
  const instalments = agreementValues?.paymentSchedule?.instalments;

  if (!instalments) {
    throw Boom.badImplementation(
      "createPayment requires a stored Agreement Payment Schedule",
    );
  }

  return instalments;
};

const findFundedEntry = (lineItem, agreementValues) => {
  const entries = lineItem.actionId
    ? agreementValues.actions
    : agreementValues.items;
  const id = lineItem.actionId ?? lineItem.itemId;
  const entry = entries.find((candidate) => candidate.id === id);

  if (!entry) {
    throw Boom.badImplementation(
      `Scheduled Line Item references unknown Agreement entry "${id}"`,
    );
  }

  return entry;
};

const validateScheduleLineItem = (lineItem) => {
  const { error, value } = paymentScheduleLineItemSchema.validate(lineItem, {
    abortEarly: false,
    allowUnknown: false,
    convert: false,
  });

  if (error) {
    throw Boom.badRequest(
      `Invalid Payment Schedule Line Item: ${error.message}`,
    );
  }

  return value;
};

const toInvoiceLine = (candidate, context) => {
  const lineItem = validateScheduleLineItem(candidate);
  const entry = findFundedEntry(lineItem, context.agreementValues);
  const { invoiceLine } = context.paymentConfiguration;

  // A configured scheme code is an intentional fixed-code policy (PMF).
  // Otherwise the referenced funded entry owns the line's scheme code. Only
  // contextual wording may be supplied by the mapped Payment Schedule line;
  // all accounting fields remain behind Payment configuration.
  return {
    schemeCode: invoiceLine.schemeCode ?? entry.code,
    description: lineItem.description ?? entry.description,
    amountPence: lineItem.amountPence,
    accountCode: invoiceLine.accountCode,
    fundCode: invoiceLine.fundCode,
    deliveryBody: context.paymentConfiguration.deliveryBody,
    marketingYear: context.paymentConfiguration.marketingYear,
  };
};

const toDuePayment = (instalment, context) => ({
  dueDate: instalment.dueDate,
  totalAmountPence: instalment.totalAmountPence,
  status: DuePaymentStatus.PENDING,
  correlationId: instalment.correlationId ?? randomUUID(),
  invoiceLines: instalment.lineItems.map((lineItem) =>
    toInvoiceLine(lineItem, context),
  ),
});

/**
 * Builds the immutable Payment projection for an accepted Agreement Version.
 *
 * Agreement values supply the promised schedule, contextual line descriptions
 * and referenced funded entries. The Agreement Definition supplies fixed-code
 * policy and accounting values. Code owns identifiers, statuses and invoice
 * numbering, while preserving a supplied due-payment correlation ID.
 */
export const buildPayment = ({
  agreementNumber,
  version,
  sbi,
  frn,
  agreementCorrelationId,
  agreementValues,
  paymentConfiguration,
  paymentHubClaimId,
  createdAt,
}) => {
  const configuration = requirePaymentConfiguration(paymentConfiguration);
  const correlationId = requireAgreementCorrelationId(agreementCorrelationId);
  const instalments = requireInstalments(agreementValues);
  const context = { agreementValues, paymentConfiguration: configuration };

  return Payment.create({
    source: {
      type: PaymentSourceType.AGREEMENT,
      agreementNumber,
      version,
    },
    sbi,
    frn,
    paymentHubClaimId,
    correlationId,
    scheme: configuration.scheme,
    sourceSystem: configuration.sourceSystem,
    deliveryBody: configuration.deliveryBody,
    fesCode: configuration.fesCode,
    paymentRequestNumber: PAYMENT_REQUEST_NUMBER,
    invoiceNumber: formatInvoiceNumber(
      paymentHubClaimId,
      PAYMENT_REQUEST_NUMBER,
    ),
    originalInvoiceNumber: "",
    ledger: configuration.ledger,
    totalAmountPence: agreementValues.totalAmountPence,
    currency: configuration.currency,
    marketingYear: configuration.marketingYear,
    payments: instalments.map((instalment) =>
      toDuePayment(instalment, context),
    ),
    createdAt,
  });
};
