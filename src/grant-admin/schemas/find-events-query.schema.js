import Joi from "joi";
import { AUDIT_EXCLUDE, AUDIT_MODES } from "../../events/event-audit.js";
import { EVENT_STATUSES } from "../../events/status-counts.js";

// Re-exported so every grant-admin schema validates against the one status
// list `events/status-counts.js` owns.
export { EVENT_STATUSES };

export const EVENT_SERVICES = ["gas", "caseworking"];

const Q_MIN = 1;
const Q_MAX = 200;
const ERROR_MIN = 1;
// The same ceiling `lastError.message` is stored under (events/last-error.js):
// a filter has to be able to name anything the store can hold, or the
// breakdown offers a group the list refuses.
const ERROR_MAX = 1024;

// `from`/`to` are validated as ISO date strings and forwarded verbatim - to
// Caseworking, and into each box's own filter - rather than being parsed into
// Date objects here. The inbox compares them as strings against a
// Z-normalised ISO sort key; only the outbox coerces, in its own repository.
export const eventRangeBound = () => Joi.string().isoDate();

// Free-text search. Trimmed, and whitespace-only is treated as absent rather
// than as a 400, so clearing the box behaves like never filling it. Shared
// with the events-page query so the two cannot select different rows.
export const eventSearchTerm = () =>
  Joi.string().trim().min(Q_MIN).max(Q_MAX).empty("");

// EXACT match on the stored `lastError.message` - see the rationale in
// events/event-list-filter.js. Shared by the list and the counts so the two
// cannot select different rows.
export const eventErrorTerm = () =>
  Joi.string().trim().min(ERROR_MIN).max(ERROR_MAX).empty("");

const isAfter = (from, to) => Date.parse(from) > Date.parse(to);

// Compared as instants, not as strings: "…T00:00:00Z" and "…T01:00:00+02:00"
// order the other way round lexically.
export const assertEventRange = (value, helpers) => {
  if (value.from && value.to && isAfter(value.from, value.to)) {
    return helpers.error("any.invalid");
  }

  return value;
};

export const EVENT_RANGE_MESSAGE =
  '"from" must be earlier than or equal to "to"';

export const eventRangeMessages = { "any.invalid": EVENT_RANGE_MESSAGE };

// Absent means `exclude`: an operator opening the events page is looking for
// work that moved or failed to move, and an audit record is neither.
// Validated as an enum so a typo is a 400 rather than a silently different
// population. Shared by the list and the events page so the two can never
// select differently - see events/event-audit.js.
export const eventAuditMode = () =>
  Joi.string()
    .valid(...AUDIT_MODES)
    .default(AUDIT_EXCLUDE);

// GAS is the single enum authority: the admin frontend forwards `status` and
// `service` unvalidated and renders the 400 from here as its in-page alert.
// The cursor is a keyset position, deliberately not bound to the filter it
// was issued under.
export const findEventsQuerySchema = Joi.object({
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
  // Inclusive at both ends and independently optional: `from` alone is
  // "since", `to` alone is "up to". Each source applies them to its own sort
  // key, so the merged page stays in one order.
  from: eventRangeBound().optional().example("2026-06-16T00:00:00.000Z"),
  to: eventRangeBound().optional().example("2026-06-16T23:59:59.999Z"),
  audit: eventAuditMode().example("include"),
})
  .custom(assertEventRange)
  .messages(eventRangeMessages)
  .label("FindEventsQuery");
