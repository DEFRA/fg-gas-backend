import { createPaymentPublication } from "../events/create-payment.event.js";
import { PaymentSourceType } from "../models/payment.js";
import {
  allocateNextSequence,
  ClaimIdCounter,
} from "../repositories/counter.repository.js";
import { insertPayment } from "../repositories/payment.repository.js";
import { formatClaimId } from "../services/claim-id.js";
import { buildPayment } from "./build-payment.js";

/**
 * The Grants module's only entry point into Payments for Claim submission.
 *
 * Called with the submitting transaction's session so the claim ID allocation
 * and the Payment insert commit with the Claim, and roll back with it. Claim
 * submission replays a duplicate Client Claim Reference, retries when the
 * Application's pinned version moves, and runs inside a transaction Mongo may
 * re-run on a transient error, so a Payment created outside that session would
 * survive a Claim that never committed. See docs/MODULE_BOUNDARIES.md — the
 * in-process call exists because a shared transaction cannot cross an event or
 * HTTP seam.
 *
 * The Agreement Number, version and Correlation ID are the Agreement the Claim
 * was made under, resolved by the caller and taken here as plain values: `payments` knows
 * nothing about Claims, Agreements or how the two are related.
 *
 * Returns the Payment with the outbox publication that sends it to the Payment
 * Service. The caller writes that publication in the same transaction; Payments
 * builds the message but never owns the outbox.
 */
export const createClaimPaymentUseCase = async (
  {
    code,
    clientRef,
    clientClaimRef,
    entitlementId,
    agreementNumber,
    agreementVersion,
    correlationId,
    resolved,
  },
  session,
) => {
  const sequence = await allocateNextSequence(ClaimIdCounter, session);

  const payment = buildPayment({
    source: {
      type: PaymentSourceType.CLAIM,
      code,
      clientRef,
      clientClaimRef,
      entitlementId,
      agreementNumber,
      agreementVersion,
    },
    correlationId,
    resolved,
    paymentHubClaimId: formatClaimId(sequence),
  });

  await insertPayment(payment, session);

  return { payment, publication: createPaymentPublication(payment) };
};
