import Boom from "@hapi/boom";
import { constants } from "node:http2";
import { logger } from "../../common/logger.js";
import { requiredActorHeaderSchema } from "../schemas/actor-header.schema.js";
import {
  EDIT_PAYLOAD_BODY_MAX_BYTES,
  editPayloadRequestSchema,
  editPayloadResponseSchema,
} from "../schemas/edit-payload-request.schema.js";
import { eventParamsSchema } from "../schemas/event-params.schema.js";
import { decodeActor } from "../services/actor-header.js";
import { callerOf } from "../services/request-caller.js";
import { editPayloadUseCase } from "../use-cases/edit-payload.use-case.js";

const actorOf = (request) => decodeActor(request.headers["x-actor"]);

// The server-wide failAction logs the whole Joi error, which carries the body
// it refused. Only the message goes out here: it names fields, never values.
const refuseInvalid = (_request, _h, error) => {
  logger.warn(`Edit payload request refused: ${error.message}`);

  throw Boom.badRequest(error.message);
};

export const editPayloadRoute = {
  method: "POST",
  path: "/grant-admin/events/{service}/{box}/{id}/payload",
  options: {
    description:
      "Admin: replace one redrivable event's payload. The event keeps its status; nothing is retried until it is redriven.",
    tags: ["api"],
    validate: {
      params: eventParamsSchema,
      headers: requiredActorHeaderSchema,
      payload: editPayloadRequestSchema,
      failAction: refuseInvalid,
    },
    payload: { maxBytes: EDIT_PAYLOAD_BODY_MAX_BYTES },
    response: { schema: editPayloadResponseSchema },
    plugins: {
      "hapi-swagger": {
        responses: {
          [constants.HTTP_STATUS_OK]: {
            description: "Saved; the paths that changed, never their values",
          },
          [constants.HTTP_STATUS_BAD_REQUEST]: {
            description:
              'A payload that is not an object, a missing or over-long note, a bad revision, or no "x-actor"',
          },
          [constants.HTTP_STATUS_NOT_FOUND]: { description: "No such event" },
          [constants.HTTP_STATUS_CONFLICT]: {
            description:
              "Not redrivable (DEAD_LETTER or PURGED); the body names its status",
          },
          [constants.HTTP_STATUS_PRECONDITION_FAILED]: {
            description: "The payload was edited since the revision given",
          },
          [constants.HTTP_STATUS_PAYLOAD_TOO_LARGE]: {
            description: "The request body is over the route's limit",
          },
          [constants.HTTP_STATUS_UNPROCESSABLE_ENTITY]: {
            description:
              "Refused; `reason` is TOO_LARGE, UNCHANGED, NOT_AN_OBJECT or DOLLAR_KEY",
          },
          [constants.HTTP_STATUS_GATEWAY_TIMEOUT]: {
            description:
              "CW-BE did not answer in time; the edit may have happened",
          },
        },
      },
    },
  },
  async handler(request) {
    const { service, box, id } = request.params;
    const { payload, note, revision } = request.payload;

    const { payloadRevision, changedPaths, changedPathsTruncated } =
      await editPayloadUseCase({
        service,
        box,
        id,
        payload,
        note,
        revision,
        caller: callerOf(request),
        actor: actorOf(request),
      });

    return { payloadRevision, changedPaths, changedPathsTruncated };
  },
};
