import { findAgreementBySourceIdentity } from "../repositories/agreement.repository.js";

export const loadEntitlementReferenceContext = async (
  { code, clientRef },
  session,
) => ({
  agreement: structuredClone(
    await findAgreementBySourceIdentity({ code, clientRef }, session),
  ),
});
