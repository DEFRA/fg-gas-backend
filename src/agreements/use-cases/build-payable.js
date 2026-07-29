import Boom from "@hapi/boom";
import { randomUUID } from "node:crypto";
import {
  Payable,
  PayableSourceType,
  PaymentStatus,
} from "../models/payable.js";
import { formatInvoiceNumber } from "../services/payables/claim-id.js";

const PAYMENT_REQUEST_NUMBER = 1;

const requireMapping = (mapping) => {
  if (!mapping) {
    throw Boom.badRequest(
      "createPayable requires a mapping from the Agreement Definition",
    );
  }

  return mapping;
};

const requirePaymentCalculation = (paymentCalculation) => {
  if (!paymentCalculation?.payments?.length) {
    throw Boom.badRequest(
      "createPayable requires a payment calculation with at least one payment",
    );
  }

  return paymentCalculation;
};

const toInvoiceLine = (line, { mapping, marketingYear }) => ({
  schemeCode: mapping.invoiceLine.schemeCode,
  description: line.description,
  amountPence: line.amountPence,
  accountCode: mapping.invoiceLine.accountCode,
  fundCode: mapping.invoiceLine.fundCode,
  deliveryBody: mapping.deliveryBody,
  marketingYear,
});

const toPayment = (payment, context) => ({
  dueDate: payment.dueDate,
  totalAmountPence: payment.totalAmountPence,
  status: PaymentStatus.PENDING,
  correlationId: randomUUID(),
  invoiceLines: payment.invoiceLines.map((line) =>
    toInvoiceLine(line, context),
  ),
});

/**
 * Builds the Payable for an accepted Agreement Version.
 *
 * Scheme specific values come from the Agreement Definition mapping; the claim
 * ID is allocated by the caller inside the action transaction, and everything
 * else is generated here.
 */
export const buildPayable = ({
  agreement,
  paymentCalculation,
  mapping,
  paymentHubClaimId,
  marketingYear = new Date().getFullYear().toString(),
  createdAt,
}) => {
  requireMapping(mapping);
  const calculation = requirePaymentCalculation(paymentCalculation);
  const context = { mapping, marketingYear };

  return Payable.create({
    source: {
      type: PayableSourceType.AGREEMENT,
      agreementNumber: agreement.agreementNumber,
      version: agreement.version,
    },
    sbi: agreement.identifiers?.sbi,
    frn: agreement.identifiers?.frn,
    paymentHubClaimId,
    scheme: mapping.scheme,
    sourceSystem: mapping.sourceSystem,
    deliveryBody: mapping.deliveryBody,
    fesCode: mapping.fesCode,
    paymentRequestNumber: PAYMENT_REQUEST_NUMBER,
    invoiceNumber: formatInvoiceNumber(
      paymentHubClaimId,
      PAYMENT_REQUEST_NUMBER,
    ),
    originalInvoiceNumber: "",
    ledger: mapping.ledger,
    totalAmountPence: calculation.agreementTotalPence,
    currency: mapping.currency,
    marketingYear,
    payments: calculation.payments.map((payment) =>
      toPayment(payment, context),
    ),
    createdAt,
  });
};
