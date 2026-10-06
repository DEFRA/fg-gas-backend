import { getRequestContext } from "../common/get-request-context.js";
import { ACTOR_ID_PATTERN } from "./schemas/actor-header.schema.js";

// The operator's Entra object id is the user of every audit event this request writes.
export const setAuditActor = (request, h) => {
  const actorId = request.headers["x-actor-id"];
  const context = getRequestContext();

  if (context && ACTOR_ID_PATTERN.test(actorId ?? "")) {
    context.user = actorId;
  }

  return h.continue;
};
