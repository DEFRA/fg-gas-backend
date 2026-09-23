import Joi from "joi";

export const EVENT_SERVICES = ["gas", "caseworking"];
export const EVENT_BOXES = ["inbox", "outbox"];

// `message` is truncated to 1024 characters and is never a stack.
export const eventLastErrorSchema = Joi.object({
  name: Joi.string().required().example("ClaimExpired"),
  message: Joi.string().allow("").required(),
  at: Joi.string().isoDate().allow(null).required(),
}).label("EventLastError");

export const eventLastRedriveSchema = Joi.object({
  at: Joi.string().isoDate().allow(null).required(),
  by: Joi.string().required().example("System"),
}).label("EventLastRedrive");

// `reasonCode` is a free string, not an enum, so a code this version has not
// heard of cannot 500 the page.
export const eventLastPurgeSchema = Joi.object({
  at: Joi.string().isoDate().allow(null).required(),
  by: Joi.string().required().example("System"),
  reasonCode: Joi.string().allow("").required().example("BROKEN_PAYLOAD"),
  note: Joi.string().allow(null, "").required(),
}).label("EventLastPurge");

export const eventLastEditSchema = Joi.object({
  at: Joi.string().isoDate().allow(null).required(),
  by: Joi.string().required().example("System"),
  note: Joi.string().allow(null, "").required(),
}).label("EventLastEdit");

const statusDisplaySchema = {
  statusLabel: Joi.string().required().example("Dead letter"),
  statusRole: Joi.string()
    .valid("neutral", "info", "warning", "success", "error")
    .required(),
  statusRetrying: Joi.boolean().required(),
};

// Never the payload, `claimedBy`, a full ARN or an audit `entityid`.
export const eventRowBaseSchema = Joi.object({
  service: Joi.string()
    .valid(...EVENT_SERVICES)
    .required(),
  box: Joi.string()
    .valid(...EVENT_BOXES)
    .required(),
  id: Joi.string().required().example("665f1c2e9a1b2c3d4e5f6a7b"),
  eventId: Joi.string().required(),
  type: Joi.string().required().example("case.status.updated"),
  // A free string, not an enum: one unexpected document must not 500 the page.
  status: Joi.string().required().example("DEAD_LETTER"),
  ...statusDisplaySchema,
  createdAt: Joi.string().isoDate().required(),
}).label("EventRow");

export const eventRowWithAttemptsSchema = eventRowBaseSchema
  .keys({
    attempts: Joi.string().required().example("5/5"),
    targetTopic: Joi.string().allow(null).required(),
    lastError: eventLastErrorSchema.allow(null).required(),
  })
  .label("EventRowWithAttempts");

export const eventRowSchema = eventRowBaseSchema
  .keys({
    latency: Joi.string().allow(null).required().example("1.2s"),
    latencyTitle: Joi.string().required().example("Received to completed"),
  })
  .label("Event");

export const statusFilterSchema = Joi.object({
  value: Joi.string().required().example("DEAD_LETTER"),
  label: Joi.string().required().example("Dead letter"),
  explainer: Joi.string()
    .required()
    .example("Failed all retry attempts; needs a redrive"),
}).label("EventStatusFilter");

export const serviceFilterSchema = Joi.object({
  value: Joi.string().required().example("caseworking"),
  label: Joi.string().required().example("CW-BE"),
}).label("EventServiceFilter");

// One keyset position per source, at the page's oldest row; forward only.
export const eventPaginationSchema = Joi.object({
  endCursor: Joi.string().allow(null).required(),
  hasNextPage: Joi.boolean().required(),
}).label("EventPagination");

export const eventSourceErrorSchema = Joi.object({
  hop: Joi.string().required().example("CW Inbox"),
}).label("EventSourceError");
