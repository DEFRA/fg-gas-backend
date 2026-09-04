import Joi from "joi";
import {
  EVENT_SERVICES,
  assertEventRange,
  eventErrorTerm,
  eventRangeBound,
  eventRangeMessages,
  eventSearchTerm,
} from "./find-events-query.schema.js";

// The counts query is the list query minus the paging keys and minus
// `status` - counting per status is the whole point, so accepting a `status`
// filter would only let a caller ask for a number it already has. Everything
// else is deliberately identical, and built from the same pieces, so the
// counts always describe exactly the list the operator is looking at.
export const countEventsQuerySchema = Joi.object({
  service: Joi.string()
    .valid(...EVENT_SERVICES)
    .optional(),
  q: eventSearchTerm().optional().example("GLD-9B2-BWS"),
  error: eventErrorTerm().optional().example("No handler found for event type"),
  from: eventRangeBound().optional().example("2026-06-16T00:00:00.000Z"),
  to: eventRangeBound().optional().example("2026-06-16T23:59:59.999Z"),
})
  .custom(assertEventRange)
  .messages(eventRangeMessages)
  .label("CountEventsQuery");
