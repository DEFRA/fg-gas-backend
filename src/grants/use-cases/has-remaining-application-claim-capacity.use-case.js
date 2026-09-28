import { countByEntitlement } from "../repositories/claim.repository.js";

const countClaims = (application, claimable, session) =>
  countByEntitlement(
    {
      code: application.code,
      clientRef: application.clientRef,
      entitlementId: claimable.entitlement.id,
    },
    session,
  );

export const hasRemainingApplicationClaimCapacityUseCase = async (
  { application, claimables },
  session,
) => {
  const counts = await Promise.all(
    claimables.map((claimable) =>
      countClaims(application, claimable, session),
    ),
  );

  return claimables.some((claimable, index) =>
    claimable.hasRemainingCapacity(counts[index]),
  );
};
