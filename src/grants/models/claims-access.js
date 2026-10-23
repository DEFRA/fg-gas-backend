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

/**
 * Whether the held roles satisfy the requirement: every `allOf` role must be
 * present, and if `anyOf` is non-empty at least one must be.
 */
export const satisfies = (heldRoles, requirements) => {
  if (!hasRoles(heldRoles)) {
    return false;
  }

  const { allOf, anyOf } = { ...defaults, ...requirements };
  const held = new Set(heldRoles);

  return allHeld(held, allOf) && anyHeld(held, anyOf);
};

/**
 * The access an operator gets to a grant's Claims.
 *
 * - `full` when the grant configures no required roles (opt-in model), or the
 *   operator satisfies them.
 * - `view-only` when the operator has Caseworking roles but not these.
 * - `hidden` when the operator has no Caseworking roles at all.
 */
export const claimsAccessFor = (requiredRoles, heldRoles) => {
  if (!requiredRoles) {
    return ACCESS_FULL;
  }
  if (!hasRoles(heldRoles)) {
    return ACCESS_HIDDEN;
  }

  return satisfies(heldRoles, requiredRoles) ? ACCESS_FULL : ACCESS_VIEW_ONLY;
};

export const assertMayChangeClaims = (access) => {
  if (access !== ACCESS_FULL) {
    throw Boom.forbidden(
      "You do not have the required roles to perform this action",
    );
  }
};

export const assertMayViewClaims = (access) => {
  if (access === ACCESS_HIDDEN) {
    throw Boom.forbidden(
      "You do not have the required roles to view claims for this grant",
    );
  }
};
