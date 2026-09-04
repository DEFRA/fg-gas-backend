import { redriveEventResponseSchema } from "../schemas/event-detail-response.schema.js";
import { eventParamsSchema } from "../schemas/event-params.schema.js";
import { actorHeaderSchema } from "../schemas/find-events-query.schema.js";
import { parkBodySchema } from "../schemas/park-body.schema.js";
import { parkEventUseCase } from "../use-cases/park-event.use-case.js";

const callerOf = (request) => request.auth?.credentials?.service ?? null;

const actorOf = (request) => request.headers["x-actor"] ?? null;

// No `auth` option: the default `service` strategy applies, so a request with
// no or an invalid bearer token is a 401 before the handler runs.
//
// Answers with the row exactly as the list renders it - now PARKED, with its
// `parked` object - so the frontend can drop it straight back into the table
// it was fired from, exactly as a redrive does.
export const parkEventRoute = {
  method: "POST",
  path: "/grant-admin/events/{service}/{box}/{id}/park",
  options: {
    description:
      "Admin: park one DEAD_LETTER event - mark it poison and take it out of the retry loop for good. 409 when the row is in any other status.",
    tags: ["api"],
    validate: {
      params: eventParamsSchema,
      headers: actorHeaderSchema,
      payload: parkBodySchema,
    },
    response: { schema: redriveEventResponseSchema },
  },
  handler(request) {
    const { service, box, id } = request.params;

    return parkEventUseCase({
      service,
      box,
      id,
      reason: request.payload.reason,
      caller: callerOf(request),
      actor: actorOf(request),
    });
  },
};
