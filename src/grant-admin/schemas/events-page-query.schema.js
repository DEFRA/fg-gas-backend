import Joi from "joi";
import {
  EVENT_SERVICES,
  EVENT_STATUSES,
  assertEventRange,
  eventAuditMode,
  eventErrorTerm,
  eventRangeBound,
  eventRangeMessages,
  eventSearchTerm,
} from "./find-events-query.schema.js";

// Exactly the list query, built from the same pieces, so the page can never
// select different rows from the ones the list would have selected on its
// own. No page-size parameter - the page size is fixed in
// services/merge-event-pages.js.
//
// `status` and `error` reach only the sections that take them: the list is
// filtered by both, the counts take `error` but not `status` (the thing they
// group by), the breakdown takes neither. The use case does that narrowing,
// so an operator's URL keeps one vocabulary.
export const eventsPageQuerySchema = Joi.object({
  cursor: Joi.string().optional(),
  direction: Joi.string().valid("forward", "backward").default("forward"),
  status: Joi.string()
    .valid(...EVENT_STATUSES)
    .optional(),
  service: Joi.string()
    .valid(...EVENT_SERVICES)
    .optional(),
  q: eventSearchTerm().optional().example("GLD-9B2-BWS"),
  error: eventErrorTerm().optional().example("No handler found for event type"),
  from: eventRangeBound().optional().example("2026-06-16T00:00:00.000Z"),
  to: eventRangeBound().optional().example("2026-06-16T23:59:59.999Z"),
  // Reaches all three sections, unlike `status` and `error`: the rows, the
  // numbers above them and the failure groups beside them must all describe
  // the same population or the page contradicts itself.
  audit: eventAuditMode().example("include"),
})
  .custom(assertEventRange)
  .messages(eventRangeMessages)
  .label("EventsPageQuery");
