import { createAgreementPaymentUseCase } from "./create-agreement-payment.use-case.js";
import { loadPaymentDefinition } from "./load-payment-definition.js";

/**
 * The Agreements module's only entry point into Payments. Stages a Commit
 * Operation — see docs/MODULE_BOUNDARIES.md for the contract.
 *
 * The Payment Definition resolves here, before the transaction opens. Resolving
 * it lazily inside commit would hold the caller's session open across JSONata
 * evaluation and turn an invalid definition into a mid-transaction failure
 * instead of leaving the Agreement in its current state.
 */
export const prepareAgreementPayment = async ({
  code,
  configVersion,
  agreement,
  execution,
}) => {
  const definition = await loadPaymentDefinition({ code, configVersion });
  const paymentConfiguration = await definition.resolve({
    agreement,
    execution,
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
