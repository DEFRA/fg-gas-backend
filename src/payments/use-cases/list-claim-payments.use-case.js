import { findClaimPaymentClientClaimRefs } from "../repositories/payment.repository.js";

// The seam other modules read Payments through, so nothing outside reaches into
// its repositories. See docs/MODULE_BOUNDARIES.md.
export const listClaimPaymentsUseCase = ({ code, clientRef }) =>
  findClaimPaymentClientClaimRefs({ code, clientRef });
