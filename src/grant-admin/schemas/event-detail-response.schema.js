import Joi from "joi";
import {
  eventLastRedriveSchema,
  eventRowSchema,
} from "./find-events-response.schema.js";

const isoOrNull = Joi.string().isoDate().allow(null).required();

// One past attempt at this event. The same three fields as `lastError`, in the
// order the detail view renders them; `message` is truncated to 512
// characters and, like `lastError`, is never a stack.
const eventAttemptSchema = Joi.object({
  at: Joi.string().isoDate().allow(null).required(),
  name: Joi.string().required().example("ClaimExpired"),
  message: Joi.string().allow("").required(),
}).label("EventAttempt");

// One event in full. Everything the list row carries, plus the fields the list
// deliberately withholds.
//
// `payload` is the stored `event` object verbatim - the ONE place an event
// payload crosses the wire, a deliberate and approved exception for the
// single-row detail view. It is `unknown(true)` because it is whatever the
// publishing service wrote; nothing here reshapes or validates it.
//
// `claimedBy` is never present: it is a live claim token, projected away by
// the repositories and stripped by Caseworking's own detail endpoint.
export const eventDetailResponseSchema = eventRowSchema
  .keys({
    payload: Joi.object().unknown(true).allow(null).required(),
    // the full ARN. The row's `target` is only the topic name after the colon.
    targetRaw: Joi.string()
      .allow(null)
      .required()
      .example("arn:aws:sns:eu-west-2:000000000000:gas__sns__create_case.fifo"),
    messageId: Joi.string().allow(null).required(),
    // the full W3C traceparent. The row's `traceId` is only the trace-id half.
    traceparent: Joi.string()
      .allow(null)
      .required()
      .example("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"),
    publicationDate: isoOrNull,
    completionDate: isoOrNull,
    lastResubmissionDate: isoOrNull,
    claimedAt: isoOrNull,
    claimExpiresAt: isoOrNull,
    claimedBy: Joi.any().forbidden(),
    // Oldest first, at most the ten most recent attempts. Always present and
    // never null: `[]` on a row that has never failed and on every row written
    // before attempt history existed, so the frontend renders an empty
    // timeline rather than branching on a missing key. Detail only - the list
    // rows carry `lastError` alone.
    attemptHistory: Joi.array().items(eventAttemptSchema).required(),
    // Who last put this row back in front of the poller, and when. Null until
    // the row has been redriven at least once. Recorded on the document as
    // well as in the audit event so the detail view can answer "who redrove
    // this?" without a search through the audit log.
    lastRedrive: eventLastRedriveSchema.allow(null).required(),
  })
  .label("EventDetail");

// A redrive answers with the row exactly as the list renders it, so the
// frontend can drop it straight back into the table it was fired from.
export const redriveEventResponseSchema = Joi.object({
  event: eventRowSchema.required(),
}).label("RedriveEventResponse");
