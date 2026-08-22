import Boom from "@hapi/boom";
import { randomUUID } from "node:crypto";
import {
  DuePaymentStatus,
  Payment,
  PaymentSourceType,
} from "../models/payment.js";
import { formatInvoiceNumber } from "../services/claim-id.js";

const PAYMENT_REQUEST_NUMBER = 1;

const requireAgreementCorrelationId = (agreementCorrelationId) => {
  if (!agreementCorrelationId) {
    throw Boom.badImplementation(
      "createPayment requires the Agreement Correlation ID",
    );
  }

  return agreementCorrelationId;
};

const toDuePayment = (duePayment, resolved) => ({
  ...duePayment,
  status: DuePaymentStatus.PENDING,
  correlationId: randomUUID(),
  invoiceLines: duePayment.invoiceLines.map((invoiceLine) => ({
    ...invoiceLine,
    deliveryBody: resolved.deliveryBody,
    marketingYear: resolved.marketingYear,
  })),
});

export const buildPayment = ({
  agreementNumber,
  version,
  agreementCorrelationId,
  resolved,
  paymentHubClaimId,
  createdAt,
}) => {
  const correlationId = requireAgreementCorrelationId(agreementCorrelationId);

  return Payment.create({
    source: {
      type: PaymentSourceType.AGREEMENT,
      agreementNumber,
      version,
    },
    sbi: resolved.sbi,
    frn: resolved.frn,
    paymentHubClaimId,
    correlationId,
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
    payments: resolved.payments.map((duePayment) =>
      toDuePayment(duePayment, resolved),
    ),
    createdAt,
  });
};
