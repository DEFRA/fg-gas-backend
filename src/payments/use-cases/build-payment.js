import Boom from "@hapi/boom";
import { randomUUID } from "node:crypto";
import {
  DuePaymentStatus,
  Payment,
  PaymentSourceType,
} from "../models/payment.js";
import { formatInvoiceNumber } from "../services/claim-id.js";

const PAYMENT_REQUEST_NUMBER = 1;

const requirePaymentConfiguration = (paymentConfiguration) => {
  if (!paymentConfiguration) {
    throw Boom.badImplementation(
      "createPayment requires a compiled Payment definition",
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

const addPlatformFields = (payment) => ({
  ...payment,
  status: DuePaymentStatus.PENDING,
  correlationId: randomUUID(),
});

export const buildPayment = ({
  agreementNumber,
  version,
  agreementCorrelationId,
  paymentConfiguration,
  paymentHubClaimId,
  createdAt,
}) => {
  const configuration = requirePaymentConfiguration(paymentConfiguration);

  return Payment.create({
    ...configuration,
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
};
