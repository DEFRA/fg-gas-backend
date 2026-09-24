import { withTransaction } from "../../common/with-transaction.js";
import { PaymentSourceType } from "../models/payment.js";
import { findOrCreatePaymentUseCase } from "../use-cases/find-or-create-payment.use-case.js";
import { resolvePaymentDefinition } from "../use-cases/resolve-payment-definition.js";

export const handleClaimPaymentRequested = async (message) => {
  const { source, agreement, configVersion, executedAt, snapshot } =
    message.event.data;
  const resolved = await resolvePaymentDefinition({
    code: source.code,
    configVersion,
    context: { claim: snapshot, execution: { executedAt } },
  });

  return withTransaction((session) =>
    findOrCreatePaymentUseCase(
      {
        source: {
          type: PaymentSourceType.CLAIM,
          ...source,
          agreementNumber: agreement.agreementNumber,
          agreementVersion: agreement.agreementVersion,
        },
        correlationId: agreement.correlationId,
        resolved,
      },
      session,
    ),
  );
};
