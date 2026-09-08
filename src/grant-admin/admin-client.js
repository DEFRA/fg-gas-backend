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
 * Hard-coded rather than configured, on purpose: a config var that is unset or
 * misspelled in one environment fails OPEN, and this is the guard in front of
 * the endpoints that can put a message back on a queue.
 */
export const ADMIN_CLIENT = "fg-grants-platform-admin";

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
  if (request.auth.credentials?.service !== ADMIN_CLIENT) {
    throw Boom.forbidden("The grant-admin API is not open to this client");
  }

  return h.continue;
};
