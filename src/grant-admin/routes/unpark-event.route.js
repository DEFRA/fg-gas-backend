import { redriveEventResponseSchema } from "../schemas/event-detail-response.schema.js";
import { eventParamsSchema } from "../schemas/event-params.schema.js";
import { actorHeaderSchema } from "../schemas/find-events-query.schema.js";
import { unparkEventUseCase } from "../use-cases/park-event.use-case.js";

const callerOf = (request) => request.auth?.credentials?.service ?? null;

const actorOf = (request) => request.headers["x-actor"] ?? null;

// PARKED -> DEAD_LETTER. Deliberately does not retry the row: it lands back
// where it was parked from, and a redrive is the separate, explicit next step.
//
// No `auth` option: the default `service` strategy applies, so a request with
// no or an invalid bearer token is a 401 before the handler runs.
export const unparkEventRoute = {
  method: "POST",
  path: "/grant-admin/events/{service}/{box}/{id}/unpark",
  options: {
    description:
      "Admin: unpark one PARKED event back to DEAD_LETTER. 409 when the row is in any other status.",
    tags: ["api"],
    validate: {
      params: eventParamsSchema,
      headers: actorHeaderSchema,
    },
    response: { schema: redriveEventResponseSchema },
  },
  handler(request) {
    const { service, box, id } = request.params;

    return unparkEventUseCase({
      service,
      box,
      id,
      caller: callerOf(request),
      actor: actorOf(request),
    });
  },
};
