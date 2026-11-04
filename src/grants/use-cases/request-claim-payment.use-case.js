import { internalEventTarget, saveEvents } from "../../events/index.js";
import { ClaimPaymentRequestedEvent } from "../events/claim-payment-requested.event.js";

// A submitted Claim requests payment only when its template needs no approval
// and the grant has a Payment Definition. Payments owns processing that request.
export const requestClaimPaymentUseCase = async (
  { claim, agreement, configVersion, paymentConfigured, requiresApproval },
  session,
) => {
  if (!paymentConfigured || requiresApproval) {
    return;
  }

  const event = new ClaimPaymentRequestedEvent({
    code: claim.code,
    clientRef: claim.clientRef,
    clientClaimRef: claim.clientClaimRef,
    entitlementId: claim.entitlementId,
    configVersion,
    agreement: {
      agreementNumber: agreement.agreementNumber,
      agreementVersion: agreement.version,
      correlationId: agreement.correlationId,
    },
    executedAt: claim.createdAt,
    claim: {
      sbi: claim.metadata.sbi,
      frn: claim.metadata.frn,
      totalAmountPence: claim.claim.totalClaimAmountPence,
    },
  });

  await saveEvents(
    [{ event, target: internalEventTarget, segregationRef: claim.clientRef }],
    session,
  );
};
