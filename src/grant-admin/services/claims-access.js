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
  if (!hasRoles(heldRoles)) {
    return false;
  }

  const { allOf, anyOf } = toReqs(requirements);
  const held = new Set(heldRoles);

  return allHeld(held, allOf) && anyHeld(held, anyOf);
};

const accessFor = (heldRoles, claimsRequiredRoles) => {
  if (!hasRoles(heldRoles)) {
    return ACCESS_HIDDEN;
  }
  if (satisfies(heldRoles, claimsRequiredRoles)) {
    return ACCESS_FULL;
  }

  return ACCESS_VIEW_ONLY;
};

/**
 * Resolves the access tier the operator gets for claims on a grant.
 *
 * - `full` when the grant has not configured any claims roles (opt-in model),
 *   without reading the operator's roles, or when the operator satisfies them.
 * - `view-only` when the operator has Caseworking roles but not these.
 * - `hidden` when the operator has no Caseworking roles at all.
 *
 * `findHeldRoles` answers the operator's roles, or rejects when they cannot be
 * determined.
 */
export const resolveClaimsAccess = async (
  claimsRequiredRoles,
  findHeldRoles,
) => {
  if (!claimsRequiredRoles) {
    return ACCESS_FULL;
  }

  return accessFor(await findHeldRoles(), claimsRequiredRoles);
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
