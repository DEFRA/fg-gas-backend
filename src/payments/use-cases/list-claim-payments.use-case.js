import { findClaimPaymentClientClaimRefs } from "../repositories/payment.repository.js";

// The read other modules use to ask which of an application's claims have a
// Payment. Exposed as a use case so nothing outside Payments reaches into its
// repositories, the way Payments keeps out of Grants.
export const listClaimPaymentsUseCase = ({ code, clientRef }) =>
  findClaimPaymentClientClaimRefs({ code, clientRef });
