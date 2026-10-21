import Boom from "@hapi/boom";

/**
 * The one caller this surface answers.
 *
 * Owner decision: the grant-admin endpoints are for the grants platform admin
 * frontend and for nothing else. GAS's service auth accepts ANY persisted,
 * unexpired access token, and the estate deliberately issues tokens to several
 * services - so authenticating is not the same as being allowed here. Without
 * this, a credential issued to any other service could read an event payload
 * or redrive a message.
 *
 * The permission is explicit, so normalising a token's client name cannot
 * promote it. Existing permissions are migrated from the old clientId guard;
 * token issuers grant this permission only to the named admin client.
 */
export { GRANT_ADMIN_CLIENT as ADMIN_CLIENT } from "../auth/service-token.js";

/**
 * 403, not 401: the caller authenticated perfectly well, and telling them
 * their credential is invalid would send them off to fix the wrong thing. The
 * message names the surface rather than the expected client - who is allowed
 * is not a caller's business.
 *
 * Registered by the grant-admin plugin against its own routes alone, so every
 * route on this surface is covered, including any added later, and no route
 * outside it is touched.
 */
export const requireAdminClient = (request, h) => {
  if (request.auth.credentials?.grantAdminAccess !== true) {
    throw Boom.forbidden("The grant-admin API is not open to this client");
  }

  return h.continue;
};
