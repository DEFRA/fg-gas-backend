import { getRequestContext } from "../common/get-request-context.js";
import { ACTOR_ID_PATTERN } from "./schemas/actor-header.schema.js";

/**
 * Records the operator's Entra object id as the user of every audit event
 * this request writes, redrives, purges and edits included.
 *
 * Optional here, so an admin that does not yet send it keeps working with an
 * empty user; the read routes require it in their header schema. A value that
 * is not an object id is ignored rather than recorded.
 */
export const setAuditActor = (request, h) => {
  const actorId = request.headers["x-actor-id"];
  const context = getRequestContext();

  if (context && ACTOR_ID_PATTERN.test(actorId ?? "")) {
    context.user = actorId;
  }

  return h.continue;
};
