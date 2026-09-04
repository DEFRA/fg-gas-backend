import Joi from "joi";
import {
  EVENT_SERVICES,
  assertEventRange,
  eventErrorTerm,
  eventRangeBound,
  eventRangeMessages,
  eventSearchTerm,
} from "./find-events-query.schema.js";

const MIN_LIMIT = 1;
const MAX_LIMIT = 500;

// A redrive by filter selects rows the same way the list does, so it is built
// from the same pieces - anything an operator can see, they can redrive, and
// nothing else.
//
// `status` is deliberately absent and implicitly DEAD_LETTER: redriving a
// PUBLISHED or COMPLETED row is meaningless, and letting the caller widen the
// status is the one way this endpoint could do real damage.
//
// `limit` caps the work of ONE call, not the size of the match. The response
// reports `matched` (how many rows the filter selects) alongside `processed`
// (how many this call attempted), so an operator can see there is more to do
// and fire it again rather than wonder whether it silently truncated.
export const redriveQuerySchema = Joi.object({
  service: Joi.string()
    .valid(...EVENT_SERVICES)
    .optional(),
  q: eventSearchTerm().optional().example("GLD-9B2-BWS"),
  error: eventErrorTerm().optional().example("No handler found for event type"),
  from: eventRangeBound().optional().example("2026-06-16T00:00:00.000Z"),
  to: eventRangeBound().optional().example("2026-06-16T23:59:59.999Z"),
  limit: Joi.number()
    .integer()
    .min(MIN_LIMIT)
    .max(MAX_LIMIT)
    .default(MAX_LIMIT)
    .optional(),
})
  .custom(assertEventRange)
  .messages(eventRangeMessages)
  .label("RedriveQuery");
