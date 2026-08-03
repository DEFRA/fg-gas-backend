import Boom from "@hapi/boom";
import { randomUUID } from "node:crypto";
import {
  DuePaymentStatus,
  Payment,
  PaymentSourceType,
} from "../models/payment.js";
import { formatInvoiceNumber } from "../services/claim-id.js";

const PAYMENT_REQUEST_NUMBER = 1;

const requireMapping = (mapping) => {
  if (!mapping) {
    throw Boom.badRequest(
      "createPayment requires a mapping from the Agreement Definition",
    );
  }

  return mapping;
};

const requirePaymentCalculation = (paymentCalculation) => {
  if (!paymentCalculation?.payments?.length) {
    throw Boom.badRequest(
      "createPayment requires a payment calculation with at least one payment",
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

const toDuePayment = (due, context) => ({
  dueDate: due.dueDate,
  totalAmountPence: due.totalAmountPence,
  status: DuePaymentStatus.PENDING,
  correlationId: randomUUID(),
  invoiceLines: due.invoiceLines.map((line) => toInvoiceLine(line, context)),
});

/**
 * Builds the Payment for an accepted Agreement Version.
 *
 * Scheme specific values come from the Agreement Definition mapping; the claim
 * ID is allocated by the caller inside the action transaction, and everything
 * else is generated here. Each payment due in the Payment Calculation carries
 * through to one entry in the Payment's own `payments`.
 */
export const buildPayment = ({
  agreementNumber,
  version,
  sbi,
  frn,
  paymentCalculation,
  mapping,
  paymentHubClaimId,
  marketingYear = new Date().getFullYear().toString(),
  createdAt,
}) => {
  requireMapping(mapping);
  const calculation = requirePaymentCalculation(paymentCalculation);
  const context = { mapping, marketingYear };

  return Payment.create({
    source: {
      type: PaymentSourceType.AGREEMENT,
      agreementNumber,
      version,
    },
    sbi,
    frn,
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
    payments: calculation.payments.map((due) => toDuePayment(due, context)),
    createdAt,
  });
};
