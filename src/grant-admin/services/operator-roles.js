import Boom from "@hapi/boom";
import { getRequestContext } from "../../common/get-request-context.js";
import { logger } from "../../common/logger.js";
import { findCwUserRoles } from "../repositories/cw-users.repository.js";

export const CASEWORKING_ROLES_UNAVAILABLE = "CASEWORKING_ROLES_UNAVAILABLE";

const NO_OPERATOR = { roles: [] };

const rolesUnavailable = () => {
  const error = Boom.serverUnavailable(
    "Caseworking roles could not be determined",
  );

  error.output.payload.errorCode = CASEWORKING_ROLES_UNAVAILABLE;

  return error;
};

// The operator is the Entra object id `setAuditActor` put on the request.
const lookUp = () => {
  const actorId = getRequestContext()?.user;

  return actorId ? findCwUserRoles(actorId) : Promise.resolve(NO_OPERATOR);
};

const rolesOf = async (answer) => {
  const { roles, failure } = await answer;

  if (roles === null) {
    logger.warn(`Operator roles could not be determined: ${failure}`);
    throw rolesUnavailable();
  }

  return roles;
};

export const findOperatorRoles = () => rolesOf(lookUp());

// Starts the lookup at once, so it runs alongside the reads that decide
// whether the roles are needed at all. A failure is logged, and the 503
// thrown, only by the function returned, and only once asked.
export const prefetchOperatorRoles = () => {
  const answer = lookUp();
  let roles;

  return () => {
    roles ??= rolesOf(answer);

    return roles;
  };
};
