import {
  ACCESS_FULL,
  assertMayChangeClaims,
  assertMayViewClaims,
  claimsAccessFor,
} from "../models/claims-access.js";

export const requiredClaimsRoles = (grant) =>
  grant.claims?.requiredRoles ?? null;

/**
 * The access the operator gets to the grant's Claims.
 *
 * `findHeldRoles` answers the operator's roles, or rejects when they cannot be
 * determined. It is asked only when the grant requires roles, and may be asked
 * again for a retry, so the caller should hand one that remembers its answer.
 */
export const resolveClaimsAccess = async (grant, findHeldRoles) => {
  const requiredRoles = requiredClaimsRoles(grant);

  if (!requiredRoles) {
    return ACCESS_FULL;
  }

  return claimsAccessFor(requiredRoles, await findHeldRoles());
};

export const requireClaimsView = async (grant, findHeldRoles) => {
  const access = await resolveClaimsAccess(grant, findHeldRoles);
  assertMayViewClaims(access);

  return access;
};

export const requireClaimsChange = async (grant, findHeldRoles) => {
  const access = await resolveClaimsAccess(grant, findHeldRoles);
  assertMayChangeClaims(access);

  return access;
};
