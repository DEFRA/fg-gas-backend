import Joi from "joi";
import { breakdownEventsResponseSchema } from "./breakdown-events-response.schema.js";
import { eventStatusCountsSchema } from "./event-status-counts.schema.js";
import {
  eventPaginationSchema,
  eventRowSchema,
  eventSourceErrorSchema,
  serviceFilterSchema,
  statusFilterSchema,
} from "./find-events-response.schema.js";
import { sectionErrorsSchema } from "./section-errors.schema.js";

// The two sections the page can lose. `counts` and `breakdown` are read
// alongside the list and are not the list, so either can be missing without
// the page being missing.
export const EVENTS_PAGE_SECTIONS = ["counts", "breakdown"];

// Everything the events page renders, in one answer. `events`, `pagination`
// and `sourceErrors` are the list's, unchanged and required: the list IS the
// page, so a list that could not be read is a failed request, not a null.
//
// `counts` and `breakdown` are the other two reads, each nullable and each
// named in `sectionErrors` when it is null. That is the frontend's own
// degradation, moved behind the one call: the figures on the filter chips and
// the dead-letter panel can each go missing without taking the table with
// them, and nothing goes missing quietly.
export const eventsPageResponseSchema = Joi.object({
  events: Joi.array().items(eventRowSchema).required(),
  pagination: eventPaginationSchema.required(),
  // Fixed vocabulary, in the order a message travels rather than
  // alphabetically: the toolbar reads left to right as a lifecycle. Never
  // null - it is a constant of the API, not a read that can fail.
  statuses: Joi.array().items(statusFilterSchema).required(),
  services: Joi.array().items(serviceFilterSchema).required(),
  counts: eventStatusCountsSchema.allow(null).required(),
  breakdown: breakdownEventsResponseSchema.allow(null).required(),
  sourceErrors: Joi.array().items(eventSourceErrorSchema).required(),
  // Empty when both sections answered - never absent, so a caller can read it
  // without a guard.
  sectionErrors: sectionErrorsSchema(
    EVENTS_PAGE_SECTIONS,
    "EventSectionError",
  ).required(),
}).label("EventsPageResponse");
