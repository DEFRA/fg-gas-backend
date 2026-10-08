import Boom from "@hapi/boom";

export const ACCESS_FULL = "full";
export const ACCESS_VIEW_ONLY = "view-only";
export const ACCESS_HIDDEN = "hidden";

const hasRoles = (heldRoles) =>
  Array.isArray(heldRoles) && heldRoles.length > 0;

const allHeld = (held, allOf) => allOf.every((role) => held.has(role));

const anyHeld = (held, anyOf) =>
  anyOf.length === 0 || anyOf.some((role) => held.has(role));

const defaults = { allOf: [], anyOf: [] };

const toReqs = (req) => ({ ...defaults, ...req });

/**
 * Whether the held roles satisfy the requirement: every `allOf` role must be
 * present, and if `anyOf` is non-empty at least one must be.
 */
export const satisfies = (heldRoles, requirements) => {
  if (!hasRoles(heldRoles)) return false;

  const { allOf, anyOf } = toReqs(requirements);
  const held = new Set(heldRoles);

  return allHeld(held, allOf) && anyHeld(held, anyOf);
};

/**
 * Resolves the access tier a user gets for claims on a grant.
 *
 * - `full` when the user satisfies `claims.requiredRoles` (or when the grant
 *   has not configured any claims roles - opt-in model).
 * - `view-only` when the user exists in CW (has any roles) but does not
 *   satisfy `claims.requiredRoles`.
 * - `hidden` when the user has no CW roles at all (unknown user or no roles).
 */
export const resolveClaimsAccess = (heldRoles, claimsRequiredRoles) => {
  if (!claimsRequiredRoles) return ACCESS_FULL;
  if (!hasRoles(heldRoles)) return ACCESS_HIDDEN;
  if (satisfies(heldRoles, claimsRequiredRoles)) return ACCESS_FULL;

  return ACCESS_VIEW_ONLY;
};

/**
 * Parse the comma-separated `x-user-roles` header into a role array.
 * An absent or blank header means "no roles known" (empty array). Trusted
 * because `requireAdminClient` already guarantees the caller is GPA.
 */
export const userRolesOf = (request) => {
  const header = request.headers["x-user-roles"];
  if (!header || typeof header !== "string") {
    return [];
  }

  return header
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
};

export const assertFullAccess = (access) => {
  if (access !== ACCESS_FULL) {
    throw Boom.forbidden(
      "You do not have the required roles to perform this action",
    );
  }
};

export const assertNotHidden = (access) => {
  if (access === ACCESS_HIDDEN) {
    throw Boom.forbidden(
      "You do not have the required roles to view claims for this grant",
    );
  }
};
