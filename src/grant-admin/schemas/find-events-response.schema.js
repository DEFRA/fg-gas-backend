import Joi from "joi";
import { EVENT_SERVICES } from "./find-events-query.schema.js";

const EVENT_BOXES = ["inbox", "outbox"];

// Null on rows that never failed and on rows written before FGP-1392.
// `message` is truncated to 1024 characters and is never a stack.
export const eventLastErrorSchema = Joi.object({
  name: Joi.string().required().example("ClaimExpired"),
  message: Joi.string().allow("").required(),
  at: Joi.string().isoDate().allow(null).required(),
}).label("EventLastError");

// Detail only - the list rows deliberately stay narrow.
export const eventLastRedriveSchema = Joi.object({
  at: Joi.string().isoDate().allow(null).required(),
  // Never null: a redrive nobody is named for is the platform's own, and it
  // is named `System` here rather than leaving the frontend to decide what an
  // absent operator is called. The document keeps its null.
  by: Joi.string().required().example("System"),
}).label("EventLastRedrive");

// Derived in services/event-display.js beside the toolbar vocabulary, so a
// badge and the chip that counts it cannot disagree about a state's name.
const statusDisplaySchema = {
  statusLabel: Joi.string().required().example("Dead letter"),
  statusRole: Joi.string()
    .valid("neutral", "info", "warning", "success", "error")
    .required(),
  statusRetrying: Joi.boolean().required(),
};

// One row of the merged inbox/outbox list, ready to render.
//
// Deliberately generic: never the event payload (`event`, `event.data`), never
// `claimedBy`, never a full ARN, never an audit `entityid` or `details`, and
// no business identifier lifted out of a payload - those belong to the Inspect
// story. Display strings travel rather than the parts they are built from;
// what stays raw is what the frontend genuinely owns (the instants, `status`
// for `?status=`, and `service`/`box`/`id` for the row's link). Every field is
// required so a mapping gap fails a test rather than rendering a blank cell.
export const eventRowBaseSchema = Joi.object({
  service: Joi.string()
    .valid(...EVENT_SERVICES)
    .required(),
  box: Joi.string()
    .valid(...EVENT_BOXES)
    .required(),
  id: Joi.string().required().example("665f1c2e9a1b2c3d4e5f6a7b"),
  eventId: Joi.string().required(),
  // Never null: a row that stores no type is labelled by the API ("audit" /
  // "unknown") rather than leaving the frontend to infer from a gap.
  type: Joi.string().required().example("case.status.updated"),
  // An outbox write and the inbox consume that answers it share an event id;
  // nothing else on either row tells them apart.
  hop: Joi.string().required().example("GAS Outbox"),
  // Null only where an outbox row names no target at all.
  queue: Joi.string().allow(null).required().example("to Caseworking"),
  // The topic exactly as the row carries it. Null on an inbox row, which
  // names a producer rather than a transport.
  queueValue: Joi.string().allow(null).required(),
  // A free string, not an enum: one unexpected document must not fail
  // response validation and 500 the whole page.
  status: Joi.string().required().example("DEAD_LETTER"),
  ...statusDisplaySchema,
  createdAt: Joi.string().isoDate().required(),
  lastError: eventLastErrorSchema.allow(null).required(),
}).label("EventRow");

// What a SINGLE-ROW answer adds: the attempt facts, which only the detail
// page draws. The list column that once carried them was removed, and a row
// the list does not render is a row the list is not sent.
export const eventRowWithAttemptsSchema = eventRowBaseSchema
  .keys({
    // Attempts MADE over allowed - both services increment the count in the
    // operation that records a failure. `-` where nothing recorded a count.
    attempts: Joi.string().required().example("5/5"),
    showAttempts: Joi.boolean().required(),
    lastFailureAt: Joi.string().isoDate().allow(null).required(),
  })
  .label("EventRowWithAttempts");

// What the LIST adds to that row, and only the list.
export const eventRowSchema = eventRowBaseSchema
  .keys({
    // Null while the row has not completed: a missing completion is not a
    // latency of zero.
    latency: Joi.string().allow(null).required().example("1.2s"),
    latencyTitle: Joi.string().required().example("Received to completed"),
  })
  .label("Event");

// One hop of a message's journey. Not the list row: a hop is timed from when
// ITS box took the message (`startedAt`), not from the producer's own clock.
export const journeyHopSchema = Joi.object({
  service: Joi.string()
    .valid(...EVENT_SERVICES)
    .required(),
  box: Joi.string()
    .valid(...EVENT_BOXES)
    .required(),
  id: Joi.string().required().example("665f1c2e9a1b2c3d4e5f6a7b"),
  hop: Joi.string().required().example("CW Inbox"),
  status: Joi.string().required().example("COMPLETED"),
  ...statusDisplaySchema,
  // On an inbox hop this is the receipt, not the CloudEvent's `time`: a slow
  // producer-to-broker leg is not the consumer's to answer for.
  startedAt: Joi.string().isoDate().required(),
  took: Joi.string().allow(null).required().example("1.2s"),
}).label("JourneyHop");

// The toolbar's chip vocabulary, stated by the API because it is the same
// table the badges are labelled from - a label derived in two places
// eventually reads two ways.
export const statusFilterSchema = Joi.object({
  value: Joi.string().required().example("DEAD_LETTER"),
  label: Joi.string().required().example("Dead letter"),
  explainer: Joi.string()
    .required()
    .example("Failed all retry attempts; needs a redrive"),
}).label("EventStatusFilter");

export const serviceFilterSchema = Joi.object({
  value: Joi.string().required().example("caseworking"),
  label: Joi.string().required().example("Caseworking"),
}).label("EventServiceFilter");

// Opaque, composite and versioned: one keyset position per source. Null on an
// empty page so the frontend renders no pager.
export const eventPaginationSchema = Joi.object({
  startCursor: Joi.string().allow(null).required(),
  endCursor: Joi.string().allow(null).required(),
  hasNextPage: Joi.boolean().required(),
  hasPreviousPage: Joi.boolean().required(),
}).label("EventPagination");

// `message` is a fixed one-liner ("timeout", "HTTP 401", "not configured",
// "read failed") and never a response body.
export const eventSourceErrorSchema = Joi.object({
  service: Joi.string()
    .valid(...EVENT_SERVICES)
    .required(),
  box: Joi.string()
    .valid(...EVENT_BOXES)
    .required(),
  // The same words the rows use, so the alert above a table and the rows in
  // it name a source one way.
  hop: Joi.string().required().example("CW Inbox"),
  message: Joi.string().required(),
}).label("EventSourceError");

export const findEventsResponseSchema = Joi.object({
  events: Joi.array().items(eventRowSchema).required(),
  pagination: eventPaginationSchema.required(),
  sourceErrors: Joi.array().items(eventSourceErrorSchema).required(),
}).label("FindEventsResponse");
