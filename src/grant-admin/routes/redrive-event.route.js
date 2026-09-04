import { redriveEventResponseSchema } from "../schemas/event-detail-response.schema.js";
import { eventParamsSchema } from "../schemas/event-params.schema.js";
import { actorHeaderSchema } from "../schemas/find-events-query.schema.js";
import { redriveEventUseCase } from "../use-cases/redrive-event.use-case.js";

const callerOf = (request) => request.auth?.credentials?.service ?? null;

// The operator this mutation is made on behalf of, as a header rather than a
// body key so every mutation route takes it the same way and a body-less POST
// still carries it. Validated by `actorHeaderSchema`, so an over-long value is
// a 400 rather than something written into an audit event and onto a document.
const actorOf = (request) => request.headers["x-actor"] ?? null;

// No `auth` option: the default `service` strategy applies, so a request with
// no or an invalid bearer token is a 401 before the handler runs.
export const redriveEventRoute = {
  method: "POST",
  path: "/grant-admin/events/{service}/{box}/{id}/redrive",
  options: {
    description:
      "Admin: put one DEAD_LETTER event back in front of its poller. 409 when the row is in any other status.",
    tags: ["api"],
    validate: { params: eventParamsSchema, headers: actorHeaderSchema },
    response: { schema: redriveEventResponseSchema },
  },
  handler(request) {
    const { service, box, id } = request.params;

    return redriveEventUseCase({
      service,
      box,
      id,
      caller: callerOf(request),
      actor: actorOf(request),
    });
  },
};
