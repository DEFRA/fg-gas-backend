import Joi from "joi";
import { eventSourceErrorSchema } from "./find-events-response.schema.js";

// What one source contributed. Broken out per source because a bulk redrive
// that half worked is the case an operator most needs to understand, and
// "17 redriven" alone does not say which box they came from.
const perSourceSchema = Joi.object({
  matched: Joi.number().integer().min(0).required(),
  processed: Joi.number().integer().min(0).required(),
  redriven: Joi.number().integer().min(0).required(),
  conflicts: Joi.number().integer().min(0).required(),
  failures: Joi.number().integer().min(0).required(),
}).label("RedriveQuerySourceResult");

// `matched` MAY exceed `processed`: `limit` caps the work of one call, not the
// size of the match, and the two are reported separately so an operator can
// see there is more to do.
//
// `conflicts` are rows that stopped being DEAD_LETTER between the id being
// collected and the redrive running - another operator got there first, or a
// poller did. They are expected, not errors. `failures` are everything else.
export const redriveQueryResponseSchema = Joi.object({
  matched: Joi.number().integer().min(0).required(),
  processed: Joi.number().integer().min(0).required(),
  redriven: Joi.number().integer().min(0).required(),
  conflicts: Joi.number().integer().min(0).required(),
  failures: Joi.number().integer().min(0).required(),
  // Keyed by the fan-out's own source keys - `gasInbox`, `gasOutbox`,
  // `cwInbox`, `cwOutbox` - the same keys the composite list cursor uses.
  perSource: Joi.object()
    .pattern(/^(gas|cw)(Inbox|Outbox)$/, perSourceSchema)
    .required()
    .label("RedriveQueryPerSource"),
  sourceErrors: Joi.array().items(eventSourceErrorSchema).required(),
}).label("RedriveQueryResponse");
