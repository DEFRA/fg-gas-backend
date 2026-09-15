import Boom from "@hapi/boom";
import { randomUUID } from "node:crypto";
import { DuePaymentStatus, Payment } from "../models/payment.js";
import { formatInvoiceNumber } from "../services/claim-id.js";

const PAYMENT_REQUEST_NUMBER = 1;

const requireCorrelationId = (correlationId) => {
  if (!correlationId) {
    throw Boom.badImplementation("createPayment requires the Correlation ID");
  }

  return correlationId;
};

const toDuePayment = (duePayment) => ({
  ...duePayment,
  status: DuePaymentStatus.PENDING,
  correlationId: randomUUID(),
});

export const buildPayment = ({
  source,
  correlationId,
  resolved,
  paymentHubClaimId,
  createdAt,
}) => {
  return Payment.create({
    source,
    correlationId: requireCorrelationId(correlationId),
    sbi: resolved.sbi,
    frn: resolved.frn,
    paymentHubClaimId,
    scheme: resolved.scheme,
    sourceSystem: resolved.sourceSystem,
    deliveryBody: resolved.deliveryBody,
    fesCode: resolved.fesCode,
    paymentRequestNumber: PAYMENT_REQUEST_NUMBER,
    invoiceNumber: formatInvoiceNumber(
      paymentHubClaimId,
      PAYMENT_REQUEST_NUMBER,
    ),
    originalInvoiceNumber: resolved.originalInvoiceNumber,
    ledger: resolved.ledger,
    totalAmountPence: resolved.totalAmountPence,
    currency: resolved.currency,
    marketingYear: resolved.marketingYear,
    payments: resolved.payments.map(toDuePayment),
    createdAt,
  });
};
