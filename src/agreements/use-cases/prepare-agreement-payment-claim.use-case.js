import Boom from "@hapi/boom";

const assertPaymentExists = (payment) => {
  if (payment) {
    return;
  }

  throw Boom.badRequest("Agreement item is missing payment data");
};

const addPaymentCorrelationIds = ({ createCorrelationId, payments }) =>
  payments.map((agreementPayment) => ({
    ...agreementPayment,
    correlationId: agreementPayment.correlationId ?? createCorrelationId(),
  }));

const preparePayment = ({ createCorrelationId, payment }) => {
  assertPaymentExists(payment);

  if (!Array.isArray(payment.payments)) {
    return payment;
  }

  return {
    ...payment,
    payments: addPaymentCorrelationIds({
      createCorrelationId,
      payments: payment.payments,
    }),
  };
};

export const prepareAgreementPaymentClaim = async ({
  createCorrelationId,
  generateClaimId,
  payment,
  previousItemState,
  session,
}) => ({
  claimId: previousItemState.claimId ?? (await generateClaimId(session)),
  correlationId: previousItemState.correlationId ?? createCorrelationId(),
  originalInvoiceNumber: previousItemState.originalInvoiceNumber ?? "",
  payment: preparePayment({
    createCorrelationId,
    payment,
  }),
});
