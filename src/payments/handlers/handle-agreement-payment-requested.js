import { isMongoDuplicateKeyError } from "../../common/mongo-errors.js";
import { withTransaction } from "../../common/with-transaction.js";
import { PaymentSourceType } from "../models/payment.js";
import { findPaymentBySource } from "../repositories/payment.repository.js";
import { findOrCreatePaymentUseCase } from "../use-cases/find-or-create-payment.use-case.js";
import { resolvePaymentDefinition } from "../use-cases/resolve-payment-definition.js";

const isAgreementSourceDuplicate = (error) =>
  isMongoDuplicateKeyError(error) &&
  ["source.agreementNumber", "source.version"].every(
    (key) => error.keyPattern?.[key] === 1,
  );

export const handleAgreementPaymentRequested = async (message) => {
  const { source, code, configVersion, executedAt, snapshot } =
    message.event.data;
  const resolved = await resolvePaymentDefinition({
    code,
    configVersion,
    context: { agreement: snapshot, execution: { executedAt } },
  });

  const paymentSource = {
    type: PaymentSourceType.AGREEMENT,
    agreementNumber: source.agreementNumber,
    version: source.agreementVersion,
  };

  try {
    return await withTransaction((session) =>
      findOrCreatePaymentUseCase(
        {
          source: paymentSource,
          correlationId: snapshot.correlationId,
          resolved,
        },
        session,
      ),
    );
  } catch (error) {
    if (!isAgreementSourceDuplicate(error)) {
      throw error;
    }

    // The losing transaction is aborted; only the winning Payment is visible.
    const existing = await findPaymentBySource(paymentSource);
    if (!existing) {
      throw error;
    }

    return existing;
  }
};
