import Joi from "joi";
import {
  eventLastRedriveSchema,
  eventRowWithAttemptsSchema,
  journeyHopSchema,
} from "./find-events-response.schema.js";
import { sectionErrorsSchema } from "./section-errors.schema.js";

const isoOrNull = Joi.string().isoDate().allow(null).required();

// `message` is truncated to 512 characters and, like `lastError`, is never a
// stack.
const eventAttemptSchema = Joi.object({
  at: Joi.string().isoDate().allow(null).required(),
  name: Joi.string().required().example("ClaimExpired"),
  message: Joi.string().allow("").required(),
  // The stack this attempt failed with, verbatim and capped at the source, so
  // the page can expand a row to reveal it. Null where there is none to
  // reveal - a row written before stacks were recorded, a claim-expiry sweep,
  // a thrown string - and the page draws no expander at all for those.
  stack: Joi.string().allow(null).required(),
}).label("EventAttempt");

// One event in full.
//
// `payload` is the stored `event` object verbatim - the ONE place an event
// payload crosses the wire, a deliberate and approved exception for the
// single-row detail view; `unknown(true)` because nothing here reshapes or
// validates what the publishing service wrote.
//
// `claimedBy` is never present: it is a live claim token, projected away by
// the repositories and stripped by Caseworking's own detail endpoint.
//
// `segregationRef`, `traceparent` and `traceId` are inbox-only and ABSENT
// rather than null on an outbox row: a field that can never have a value on a
// kind is a field that kind should not carry.
export const eventDetailResponseSchema = eventRowWithAttemptsSchema
  .keys({
    payload: Joi.object().unknown(true).allow(null).required(),
    // Null when the long and short forms agree, so the frontend hangs a
    // title on it without comparing anything.
    typeTitle: Joi.string()
      .allow(null)
      .required()
      .example("cloud.defra.prd.fg-gas-backend.case.update.status"),
    // Lifted out of the payload so the page renders them rather than going
    // looking for them inside it.
    occurredAt: isoOrNull,
    messageGroupId: Joi.string().allow(null).required(),
    segregationRef: Joi.string().allow(null),
    // the full W3C traceparent, and the trace-id half OpenSearch indexes
    traceparent: Joi.string()
      .allow(null)
      .example("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"),
    traceId: Joi.string()
      .allow(null)
      .example("4bf92f3577b34da6a3ce929d0e0e4736"),
    publicationDate: isoOrNull,
    completionDate: isoOrNull,
    lastResubmissionDate: isoOrNull,
    claimedAt: isoOrNull,
    claimExpiresAt: isoOrNull,
    claimedBy: Joi.any().forbidden(),
    // Oldest first, at most the ten most recent attempts. Never null: `[]` on
    // a row that never failed or predates attempt history, so the frontend
    // renders an empty timeline rather than branching on a missing key.
    attemptHistory: Joi.array().items(eventAttemptSchema).required(),
    // Recorded on the document as well as in the audit event so the detail
    // view answers "who redrove this?" without a search through the audit log.
    lastRedrive: eventLastRedriveSchema.allow(null).required(),
  })
  .label("EventDetail");

// The one section the detail page can lose.
export const EVENT_DETAIL_SECTIONS = ["journey"];

// The detail page in one read: the event in full plus every hop carrying its
// event id. `journey` carries hops, not rows, and includes the event's own
// hop, which the page marks.
//
// `journey` is nullable: a journey that could not be read is a page with the
// event on it and no hop table - far better than no page. It is the ONLY null
// here; the event itself is the page, so a detail that could not be read
// keeps its own status, 404 included.
export const eventDetailPageResponseSchema = eventDetailResponseSchema
  .keys({
    journey: Joi.array().items(journeyHopSchema).allow(null).required(),
    // The journey is one page of a merged list, so an event with more hops
    // than a page loses the OLDEST of them - its origin. Saying so lets the
    // page say so; silently showing four hops of six answers "where did this
    // go?" wrongly and looks right doing it.
    journeyTruncated: Joi.boolean().required(),
    // Never absent, so a caller can read it without a guard.
    sectionErrors: sectionErrorsSchema(
      EVENT_DETAIL_SECTIONS,
      "EventDetailSectionError",
    ).required(),
  })
  .label("EventDetailPage");

// A redrive answers with the row as the detail page renders it, so the
// frontend can drop it straight back into the page it was fired from.
export const redriveEventResponseSchema = Joi.object({
  event: eventRowWithAttemptsSchema.required(),
}).label("RedriveEventResponse");
