import Joi from "joi";

export const EVENT_STATUSES = [
  "PUBLISHED",
  "PROCESSING",
  "FAILED",
  "RESUBMITTED",
  "COMPLETED",
  "DEAD_LETTER",
];

export const EVENT_SERVICES = ["gas", "caseworking"];

const Q_MIN = 1;
const Q_MAX = 200;
const ERROR_MIN = 1;
const ERROR_MAX = 512;
const ACTOR_MAX = 128;

// `from`/`to` are validated as ISO date strings and forwarded verbatim - to
// Caseworking, and into each box's own filter - rather than being parsed into
// Date objects here. The inbox compares them as strings against a
// Z-normalised ISO sort key; only the outbox coerces, in its own repository.
export const eventRangeBound = () => Joi.string().isoDate();

// Free-text search. Trimmed, and whitespace-only is treated as absent rather
// than as a 400, so clearing the box behaves like never filling it. Shared
// with the counts query so the two cannot select different rows.
export const eventSearchTerm = () =>
  Joi.string().trim().min(Q_MIN).max(Q_MAX).empty("");

// EXACT match on the stored `lastError.message`, never a prefix or a
// substring: the value comes from a breakdown group, which is grouped on that
// exact string, so a looser match here would silently merge two distinct
// failures. AND-ed with every other filter. Shared by the list, the counts,
// the breakdown and the redrive-by-filter queries so none of them can select
// a different set of rows from the others.
export const eventErrorTerm = () =>
  Joi.string().trim().min(ERROR_MIN).max(ERROR_MAX).empty("");

// Who a mutation is made on behalf of, read from the `x-actor` request header.
// Optional: an unattributed redrive is still a redrive. Validated here so a
// 200-character header is a 400 rather than something written to an audit
// event and to a document.
export const actorHeaderSchema = Joi.object({
  "x-actor": Joi.string().trim().max(ACTOR_MAX).empty("").optional(),
})
  .unknown(true)
  .label("ActorHeaders");

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

// GAS is the single enum authority: the admin frontend forwards `status` and
// `service` unvalidated and renders the 400 from here as its in-page alert.
// No status and no service means All: every status, both services and both
// boxes. The cursor is a keyset position, so it stays decodable
// under any filter and is deliberately not bound to the filter it was issued under.
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
})
  .custom(assertEventRange)
  .messages(eventRangeMessages)
  .label("FindEventsQuery");
