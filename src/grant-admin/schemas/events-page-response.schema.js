import Joi from "joi";
import { breakdownEventsResponseSchema } from "./breakdown-events-response.schema.js";
import { eventStatusCountsSchema } from "./event-status-counts.schema.js";
import {
  eventPaginationSchema,
  eventRowSchema,
  eventSourceErrorSchema,
  serviceFilterSchema,
  statusFilterSchema,
} from "./events-shared.schema.js";
import { sectionErrorsSchema } from "./section-errors.schema.js";

export const EVENTS_PAGE_SECTIONS = ["counts", "breakdown"];

// The list is the page, so it cannot be null; counts and breakdown can, named in sectionErrors.
export const eventsPageResponseSchema = Joi.object({
  events: Joi.array().items(eventRowSchema).required(),
  pagination: eventPaginationSchema.required(),
  // In lifecycle order, not alphabetical: the toolbar reads left to right.
  statuses: Joi.array().items(statusFilterSchema).required(),
  services: Joi.array().items(serviceFilterSchema).required(),
  counts: eventStatusCountsSchema.allow(null).required(),
  breakdown: breakdownEventsResponseSchema.allow(null).required(),
  sourceErrors: Joi.array().items(eventSourceErrorSchema).required(),
  sectionErrors: sectionErrorsSchema(
    EVENTS_PAGE_SECTIONS,
    "EventSectionError",
  ).required(),
}).label("EventsPageResponse");
