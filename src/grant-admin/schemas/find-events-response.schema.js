import Joi from "joi";
import { EVENT_SERVICES } from "./find-events-query.schema.js";

const EVENT_BOXES = ["inbox", "outbox"];

// One row of the merged inbox/outbox list. Deliberately generic: never the
// event payload (`event`, `event.data`), never `claimedBy`, never a full ARN,
// never an audit `entityid` or `details`, and no business identifier lifted out
// of a payload - those belong to the Inspect story. There is no `kind`: audit
// rows are recognised structurally in the mapper and announce themselves
// through `type` ("audit · <entity>.<action>") and a null `fullType`.
// Every field is required so a mapping gap fails a test rather than rendering
// as a blank cell.
const event = Joi.object({
  service: Joi.string()
    .valid(...EVENT_SERVICES)
    .required(),
  box: Joi.string()
    .valid(...EVENT_BOXES)
    .required(),
  id: Joi.string().required().example("665f1c2e9a1b2c3d4e5f6a7b"),
  eventId: Joi.string().required(),
  type: Joi.string().required().example("case.status.updated"),
  fullType: Joi.string()
    .allow(null)
    .required()
    .example("cloud.defra.prd.fg-gas-backend.case.update.status"),
  source: Joi.string().allow(null).required(),
  target: Joi.string().allow(null).required(),
  segregationRef: Joi.string().allow(null).required(),
  // Validated as a free string, not an enum: the documented values are
  // PUBLISHED, PROCESSING, FAILED, RESUBMITTED, COMPLETED and DEAD_LETTER, but
  // one unexpected document must not fail response validation and 500 the whole
  // page. The frontend renders anything unrecognised with a ghost badge.
  status: Joi.string().required().example("DEAD_LETTER"),
  // Never null: both models default completionAttempts to 1 on insert, GAS knows its own
  // caps from config and CW returns maxAttempts per row (required in Plan 03's schema).
  attempts: Joi.number().integer().min(1).required(),
  maxAttempts: Joi.number().integer().min(1).required(),
  // The OpenSearch `trace.id` for this event, already extracted from the W3C
  // traceparent where there was one. Null when the event carries no trace at
  // all (every audit row, and anything published before tracing).
  traceId: Joi.string()
    .allow(null)
    .required()
    .example("4bf92f3577b34da6a3ce929d0e0e4736"),
  createdAt: Joi.string().isoDate().required(),
  lastFailureAt: Joi.string().isoDate().allow(null).required(),
  completedAt: Joi.string().isoDate().allow(null).required(),
}).label("Event");

// Opaque, composite and versioned: one keyset position per source. Null on an
// empty page so the frontend renders no pager.
const pagination = Joi.object({
  startCursor: Joi.string().allow(null).required(),
  endCursor: Joi.string().allow(null).required(),
  hasNextPage: Joi.boolean().required(),
  hasPreviousPage: Joi.boolean().required(),
}).label("EventPagination");

// A source that could not be read - either service, either box. `message` is a
// fixed one-liner ("timeout", "HTTP 401", "not configured", "read failed") and
// never a response body.
const sourceError = Joi.object({
  service: Joi.string()
    .valid(...EVENT_SERVICES)
    .required(),
  box: Joi.string()
    .valid(...EVENT_BOXES)
    .required(),
  message: Joi.string().required(),
}).label("EventSourceError");

export const findEventsResponseSchema = Joi.object({
  events: Joi.array().items(event).required(),
  pagination: pagination.required(),
  sourceErrors: Joi.array().items(sourceError).required(),
}).label("FindEventsResponse");
