import Joi from "joi";
import {
  EVENT_SERVICES,
  assertEventRange,
  eventRangeBound,
  eventRangeMessages,
  eventSearchTerm,
} from "./find-events-query.schema.js";

// Exactly the counts query, built from exactly the same pieces: the breakdown
// is the counts endpoint sliced a different way, so the two must select the
// same rows or the groups would not add up to the DEAD_LETTER count above them.
//
// There is deliberately no `status`: the breakdown is always and only over
// DEAD_LETTER rows - a row that is still retrying has not failed for good yet.
// And no `error` either - filtering a breakdown by one error message would
// answer a question the breakdown already answers.
export const breakdownEventsQuerySchema = Joi.object({
  service: Joi.string()
    .valid(...EVENT_SERVICES)
    .optional(),
  q: eventSearchTerm().optional().example("GLD-9B2-BWS"),
  from: eventRangeBound().optional().example("2026-06-16T00:00:00.000Z"),
  to: eventRangeBound().optional().example("2026-06-16T23:59:59.999Z"),
})
  .custom(assertEventRange)
  .messages(eventRangeMessages)
  .label("BreakdownEventsQuery");
