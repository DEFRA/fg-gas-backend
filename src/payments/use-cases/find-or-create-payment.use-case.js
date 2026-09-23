import { saveEvents } from "../../events/index.js";
import { createPaymentPublication } from "../events/create-payment.event.js";
import {
  allocateNextSequence,
  ClaimIdCounter,
} from "../repositories/counter.repository.js";
import {
  findPaymentBySource,
  insertPayment,
} from "../repositories/payment.repository.js";
import { formatClaimId } from "../services/claim-id.js";
import { buildPayment } from "./build-payment.js";

export const findOrCreatePaymentUseCase = async (
  { source, correlationId, resolved },
  session,
) => {
  const existing = await findPaymentBySource(source, session);
  if (existing) {
    return existing;
  }

  const sequence = await allocateNextSequence(ClaimIdCounter, session);
  const payment = buildPayment({
    source,
    correlationId,
    resolved,
    paymentHubClaimId: formatClaimId(sequence),
  });

  await insertPayment(payment, session);
  await saveEvents([createPaymentPublication(payment)], session);

  return payment;
};
