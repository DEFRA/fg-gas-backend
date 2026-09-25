import { isMongoDuplicateKeyError } from "../../common/mongo-errors.js";
import { withTransaction } from "../../common/with-transaction.js";
import { PaymentSourceType } from "../models/payment.js";
import { findPaymentBySource } from "../repositories/payment.repository.js";
import { findOrCreatePaymentUseCase } from "../use-cases/find-or-create-payment.use-case.js";
import { resolvePaymentDefinition } from "../use-cases/resolve-payment-definition.js";

// Match the key pattern of the claim_payment_source_unique partial index.
const isClaimSourceDuplicate = (error) =>
  isMongoDuplicateKeyError(error) &&
  ["source.code", "source.clientRef", "source.clientClaimRef"].every(
    (key) => error.keyPattern?.[key] === 1,
  );

const recoverClaimSourceDuplicate = async (error, source) => {
  if (!isClaimSourceDuplicate(error)) {
    throw error;
  }

  // The losing transaction is aborted; only a committed winner can complete it.
  const winner = await findPaymentBySource(source);
  if (!winner) {
    throw error;
  }

  return winner;
};

export const handleClaimPaymentRequested = async (message) => {
  const { source, agreement, configVersion, executedAt, snapshot } =
    message.event.data;
  const paymentSource = {
    type: PaymentSourceType.CLAIM,
    ...source,
    agreementNumber: agreement.agreementNumber,
    agreementVersion: agreement.agreementVersion,
  };

  // A completed request must not depend on its old definition still being available.
  const existing = await findPaymentBySource(paymentSource);
  if (existing) {
    return existing;
  }

  const resolved = await resolvePaymentDefinition({
    code: source.code,
    configVersion,
    context: { claim: snapshot, execution: { executedAt } },
  });

  try {
    return await withTransaction((session) =>
      findOrCreatePaymentUseCase(
        {
          source: paymentSource,
          correlationId: agreement.correlationId,
          resolved,
        },
        session,
      ),
    );
  } catch (error) {
    return recoverClaimSourceDuplicate(error, paymentSource);
  }
};
