import { constants } from "node:http2";
import { actorHeaderSchema } from "../schemas/actor-header.schema.js";
import { eventParamsSchema } from "../schemas/event-params.schema.js";
import { decodeActor } from "../services/actor-header.js";
import { callerOf } from "../services/request-caller.js";
import { redriveEventUseCase } from "../use-cases/redrive-event.use-case.js";

// Encoded by the caller when the name has characters a header cannot carry.
const actorOf = (request) => decodeActor(request.headers["x-actor"]) ?? null;

export const redriveEventRoute = {
  method: "POST",
  path: "/grant-admin/events/{service}/{box}/{id}/redrive",
  options: {
    description:
      "Admin: put one DEAD_LETTER or PURGED event back in front of its poller. 409 when the row is in any other status.",
    tags: ["api"],
    validate: { params: eventParamsSchema, headers: actorHeaderSchema },
    plugins: {
      "hapi-swagger": {
        responses: {
          [constants.HTTP_STATUS_NO_CONTENT]: { description: "Redriven" },
          [constants.HTTP_STATUS_NOT_FOUND]: { description: "No such event" },
          [constants.HTTP_STATUS_CONFLICT]: {
            description: "Not redrivable; the body names its status",
          },
          [constants.HTTP_STATUS_GATEWAY_TIMEOUT]: {
            description:
              "CW-BE did not answer in time; the redrive may have happened",
          },
        },
      },
    },
  },
  // No body: the admin redirects after a redrive and reads the row again.
  async handler(request, h) {
    const { service, box, id } = request.params;

    await redriveEventUseCase({
      service,
      box,
      id,
      caller: callerOf(request),
      actor: actorOf(request),
    });

    return h.response().code(constants.HTTP_STATUS_NO_CONTENT);
  },
};
