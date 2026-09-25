import { constants } from "node:http2";
import { requiredActorHeaderSchema } from "../schemas/actor-header.schema.js";
import { eventParamsSchema } from "../schemas/event-params.schema.js";
import { purgeEventRequestSchema } from "../schemas/purge-event-request.schema.js";
import { decodeActor } from "../services/actor-header.js";
import { callerOf } from "../services/request-caller.js";
import { purgeEventUseCase } from "../use-cases/purge-event.use-case.js";

// Encoded by the caller when the name has characters a header cannot carry.
// The header is required here, so there is always one to decode.
const actorOf = (request) => decodeActor(request.headers["x-actor"]);

export const purgeEventRoute = {
  method: "POST",
  path: "/grant-admin/events/{service}/{box}/{id}/purge",
  options: {
    description:
      "Admin: set one DEAD_LETTER event aside with a reason. It leaves the dead-letter list, keeps its payload, and is deleted on its new deletion date.",
    tags: ["api"],
    validate: {
      params: eventParamsSchema,
      headers: requiredActorHeaderSchema,
      payload: purgeEventRequestSchema,
    },
    plugins: {
      "hapi-swagger": {
        responses: {
          [constants.HTTP_STATUS_NO_CONTENT]: { description: "Purged" },
          [constants.HTTP_STATUS_BAD_REQUEST]: {
            description:
              'Unknown reason code, a missing or over-long note, or no "x-actor"',
          },
          [constants.HTTP_STATUS_NOT_FOUND]: { description: "No such event" },
          [constants.HTTP_STATUS_CONFLICT]: {
            description: "Not DEAD_LETTER; the body names its status",
          },
          [constants.HTTP_STATUS_GATEWAY_TIMEOUT]: {
            description:
              "CW-BE did not answer in time; the purge may have happened",
          },
        },
      },
    },
  },
  // No body: the admin redirects after a purge and reads the row again.
  async handler(request, h) {
    const { service, box, id } = request.params;
    const { reasonCode, note } = request.payload;

    await purgeEventUseCase({
      service,
      box,
      id,
      reasonCode,
      note: note ?? null,
      caller: callerOf(request),
      actor: actorOf(request),
    });

    return h.response().code(constants.HTTP_STATUS_NO_CONTENT);
  },
};
