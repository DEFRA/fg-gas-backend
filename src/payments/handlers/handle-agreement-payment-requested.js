import { withTransaction } from "../../common/with-transaction.js";
import { PaymentSourceType } from "../models/payment.js";
import { findOrCreatePaymentUseCase } from "../use-cases/find-or-create-payment.use-case.js";
import { resolvePaymentDefinition } from "../use-cases/resolve-payment-definition.js";

export const handleAgreementPaymentRequested = async (message) => {
  const { source, code, configVersion, executedAt, snapshot } =
    message.event.data;
  const resolved = await resolvePaymentDefinition({
    code,
    configVersion,
    context: { agreement: snapshot, execution: { executedAt } },
  });

  return withTransaction((session) =>
    findOrCreatePaymentUseCase(
      {
        source: {
          type: PaymentSourceType.AGREEMENT,
          agreementNumber: source.agreementNumber,
          version: source.agreementVersion,
        },
        correlationId: snapshot.correlationId,
        resolved,
      },
      session,
    ),
  );
};
