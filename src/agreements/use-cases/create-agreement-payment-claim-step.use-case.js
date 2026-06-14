import { resolveActionPath } from "./agreement-action-paths.js";
import { prepareAgreementPaymentClaim } from "./prepare-agreement-payment-claim.use-case.js";
import { recordAgreementPaymentClaimPublicationIntent } from "./record-agreement-publication-intent.use-case.js";

const getResolutionRoot = ({ context }) => ({
  ...context,
  action: context.actionState,
});

const resolveStepPayment = ({ context, step }) =>
  resolveActionPath(getResolutionRoot({ context }), step.payment);

export const createAgreementPaymentClaimStep = async ({ context, step }) => {
  const preparedPaymentClaim = await prepareAgreementPaymentClaim({
    createCorrelationId: context.createCorrelationId,
    generateClaimId: context.generateClaimId,
    payment: resolveStepPayment({ context, step }),
    previousItemState: context.previousItemState,
    session: context.session,
  });

  return {
    actionState: {
      ...context.actionState,
      paymentClaim: preparedPaymentClaim,
    },
    publication: recordAgreementPaymentClaimPublicationIntent({
      paymentClaim: step.paymentClaim,
      publication: context.publication,
    }),
  };
};
