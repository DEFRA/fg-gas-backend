import { createPaymentPublication } from "../events/create-payment.event.js";
import {
  allocateNextSequence,
  ClaimIdCounter,
} from "../repositories/counter.repository.js";
import { insertPayment } from "../repositories/payment.repository.js";
import { formatClaimId } from "../services/claim-id.js";
import { buildPayment } from "./build-payment.js";

/**
 * The Agreements module's only entry point into Payments.
 *
 * Called with the accepting action's session so the claim ID allocation and the
 * Payment insert commit with the Agreement, its Version and the lifecycle
 * event, and roll back together when anything before the commit fails. See
 * docs/MODULE_BOUNDARIES.md — the in-process call exists because a shared
 * transaction cannot cross an event or HTTP seam.
 *
 * Returns the Payment with the outbox publication that sends it to the Payment
 * Service. The caller writes that publication in the same transaction; Payments
 * builds the message but never owns the outbox.
 */
export const createAgreementPaymentUseCase = async (
  {
    agreementNumber,
    version,
    sbi,
    frn,
    agreementCorrelationId,
    agreementValues,
    paymentConfiguration,
  },
  session,
) => {
  const sequence = await allocateNextSequence(ClaimIdCounter, session);

  const payment = buildPayment({
    agreementNumber,
    version,
    sbi,
    frn,
    agreementCorrelationId,
    agreementValues,
    paymentConfiguration,
    paymentHubClaimId: formatClaimId(sequence),
  });

  await insertPayment(payment, session);

  return { payment, publication: createPaymentPublication(payment) };
};
