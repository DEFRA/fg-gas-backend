import { createAgreementPaymentUseCase } from "./create-agreement-payment.use-case.js";
import { preparePayment } from "./prepare-payment.js";

/**
 * The Agreements module's only entry point into Payments.
 *
 * Stages a Commit Operation: an opaque handle Agreements runs inside its action
 * transaction. Agreements never sees the Payment or its configuration — it
 * supplies the Agreement facts that are only known once the transition has been
 * materialised, and receives back the outbox publication to write and the Claim
 * ID its own lifecycle event carries. See docs/MODULE_BOUNDARIES.md.
 *
 * The Payment Definition resolves here, before the transaction opens. Resolving
 * it lazily inside commit would hold the session open across JSONata evaluation
 * and turn an invalid definition into a mid-transaction failure instead of
 * leaving the Agreement in its current state.
 */
export const prepareAgreementPayment = async ({
  code,
  configVersion,
  agreement,
  execution,
}) => {
  const paymentConfiguration = await preparePayment({
    code,
    configVersion,
    context: { agreement, execution },
  });

  const commit = async (
    { agreementNumber, version, correlationId },
    session,
  ) => {
    const { payment, publication } = await createAgreementPaymentUseCase(
      {
        agreementNumber,
        version,
        agreementCorrelationId: correlationId,
        paymentConfiguration,
      },
      session,
    );

    return { publication, claimId: payment.paymentHubClaimId };
  };

  return { commitOperations: [Object.freeze({ commit })] };
};
