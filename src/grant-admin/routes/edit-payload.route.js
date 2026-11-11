import { constants } from "node:http2";
import { requiredActorHeaderSchema } from "../schemas/actor-header.schema.js";
import {
  EDIT_PAYLOAD_BODY_MAX_BYTES,
  editPayloadRequestSchema,
  editPayloadResponseSchema,
  staleRevisionResponseSchema,
} from "../schemas/edit-payload-request.schema.js";
import { eventParamsSchema } from "../schemas/event-params.schema.js";
import { decodeActor } from "../services/actor-header.js";
import { callerOf } from "../services/request-caller.js";
import { safeFailAction } from "../services/safe-fail-action.js";
import { saveEventPayloadUseCase } from "../use-cases/save-event-payload.use-case.js";
import {
  SHELL_ERRORS,
  SHELL_NOTES,
  shellPlugins,
} from "../services/shell-tag.js";

const actorOf = (request) => decodeActor(request.headers["x-actor"]);

export const editPayloadRoute = {
  method: "POST",
  path: "/grant-admin/events/{service}/{box}/{id}/payload",
  options: {
    description:
      "Admin: replace one redrivable event's payload. The event keeps its status and nothing is retried until it is redriven, unless `redrive` asks for that too; a refused or failed redrive leaves the save standing and says so in `redrive`.",
    tags: ["api"],
    validate: {
      params: eventParamsSchema,
      headers: requiredActorHeaderSchema,
      payload: editPayloadRequestSchema,
      failAction: safeFailAction("Edit payload"),
    },
    payload: { maxBytes: EDIT_PAYLOAD_BODY_MAX_BYTES },
    response: { schema: editPayloadResponseSchema },
    notes: SHELL_NOTES[SHELL_ERRORS],
    plugins: {
      ...shellPlugins(SHELL_ERRORS),
      "hapi-swagger": {
        responses: {
          [constants.HTTP_STATUS_OK]: {
            description:
              "Saved; the paths that changed, never their values, and what came of a redrive asked for",
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
            description:
              "The payload was edited since the revision given; `code` is STALE_REVISION and `event` the event as GET /grant-admin/events/{service}/{box}/{id} answers it, or null when it cannot be read",
            schema: staleRevisionResponseSchema,
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
    const { payload, note, revision, redrive } = request.payload;

    const saved = await saveEventPayloadUseCase({
      service,
      box,
      id,
      payload,
      note,
      revision,
      redrive,
      caller: callerOf(request),
      actor: actorOf(request),
    });

    return {
      payloadRevision: saved.payloadRevision,
      changedPaths: saved.changedPaths,
      changedPathsTruncated: saved.changedPathsTruncated,
      redrive: saved.redrive,
    };
  },
};
