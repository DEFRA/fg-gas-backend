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
 */
export const createAgreementPaymentUseCase = async (
  {
    agreementNumber,
    version,
    sbi,
    frn,
    paymentCalculation,
    mapping,
    marketingYear,
  },
  session,
) => {
  const sequence = await allocateNextSequence(ClaimIdCounter, session);

  const payment = buildPayment({
    agreementNumber,
    version,
    sbi,
    frn,
    paymentCalculation,
    mapping,
    marketingYear,
    paymentHubClaimId: formatClaimId(sequence),
  });

  await insertPayment(payment, session);

  return payment;
};
