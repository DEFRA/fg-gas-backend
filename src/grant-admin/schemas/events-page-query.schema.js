import Joi from "joi";
import { AUDIT_EXCLUDE, AUDIT_MODES } from "../../events/event-audit.js";
import { EVENT_STATUSES } from "../../events/status-counts.js";
import { EVENT_SERVICES } from "./events-shared.schema.js";

const Q_MAX = 200;
// Matches the stored `lastError.message` cap, so a filter can name any stored message.
const ERROR_MAX = 1024;

// A string, not a Date: each box coerces the bound to its own stored type.
const rangeBound = () => Joi.string().isoDate();

const term = (max) => Joi.string().trim().min(1).max(max).empty("");

// Compared as instants: offset-bearing strings order differently lexically.
const assertRange = (value, helpers) =>
  value.from && value.to && Date.parse(value.from) > Date.parse(value.to)
    ? helpers.error("any.invalid")
    : value;

export const eventsPageQuerySchema = Joi.object({
  cursor: Joi.string().optional(),
  status: Joi.string()
    .valid(...EVENT_STATUSES)
    .optional(),
  service: Joi.string()
    .valid(...EVENT_SERVICES)
    .optional(),
  q: term(Q_MAX).optional().example("GLD-9B2-BWS"),
  error: term(ERROR_MAX).optional().example("No handler found for event type"),
  from: rangeBound().optional().example("2026-06-16T00:00:00.000Z"),
  to: rangeBound().optional().example("2026-06-16T23:59:59.999Z"),
  // Absent means `exclude`: an operator on the events page is not looking for audit records.
  audit: Joi.string()
    .valid(...AUDIT_MODES)
    .default(AUDIT_EXCLUDE)
    .example("include"),
})
  .custom(assertRange)
  .messages({ "any.invalid": '"from" must be earlier than or equal to "to"' })
  .label("EventsPageQuery");
