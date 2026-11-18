import { constants } from "node:http2";
import Joi from "joi";
import { EDIT_NOTE_MAX, PAYLOAD_MAX_BYTES } from "../../events/event-edit.js";
import { eventDetailResponseSchema } from "./event-detail-response.schema.js";

// The bound is on the pretty-printed payload and the body carries it compact,
// so a payload within it always fits; the rest is room for the note.
export const EDIT_PAYLOAD_BODY_MAX_BYTES = PAYLOAD_MAX_BYTES + 16 * 1024;

// `unknown(true)` and no keys: nothing inside the payload is validated here,
// so no validation message can quote a value from it.
export const editPayloadRequestSchema = Joi.object({
  payload: Joi.object()
    .unknown(true)
    .required()
    .description("The whole replacement event, envelope included"),
  note: Joi.string()
    .trim()
    .min(1)
    .max(EDIT_NOTE_MAX)
    .required()
    .description(
      `Why the payload was changed. At most ${EDIT_NOTE_MAX} characters. Never personal data.`,
    ),
  revision: Joi.number()
    .integer()
    .min(0)
    .required()
    .description("The payloadRevision the edit was made from")
    .example(0),
  redrive: Joi.boolean()
    .default(false)
    .description(
      "Redrive the event once it is saved: for a GAS event in the same transaction",
    ),
}).label("EditPayloadRequest");

const redriveOutcomeSchema = Joi.alternatives()
  .try(
    Joi.object({ outcome: Joi.string().valid("redriven").required() }),
    Joi.object({
      outcome: Joi.string().valid("conflict").required(),
      status: Joi.string().allow(null).required(),
      statusLabel: Joi.string().allow(null).required(),
    }),
    Joi.object({ outcome: Joi.string().valid("failed").required() }),
  )
  .allow(null)
  .label("EditPayloadRedrive");

export const editPayloadResponseSchema = Joi.object({
  payloadRevision: Joi.number().integer().min(1).required().example(1),
  changedPaths: Joi.array()
    .items(Joi.string().allow(""))
    .required()
    .example(["/data/sheetId"]),
  changedPathsTruncated: Joi.boolean().required(),
  // Null when no redrive was asked for; the save stands whatever it says.
  redrive: redriveOutcomeSchema.required(),
}).label("EditPayloadResponse");

export const staleRevisionResponseSchema = Joi.object({
  statusCode: Joi.number()
    .valid(constants.HTTP_STATUS_PRECONDITION_FAILED)
    .required(),
  error: Joi.string().required(),
  message: Joi.string().required(),
  code: Joi.string().valid("STALE_REVISION").required(),
  event: eventDetailResponseSchema.allow(null).required(),
}).label("StaleRevisionResponse");
