import Joi from "joi";
import { eventSourceErrorSchema } from "./find-events-response.schema.js";

// One group of dead letters that failed the same way on the same event type,
// summed across every selected source.
//
// `error` is the stored `lastError.message` VERBATIM, and is the exact value
// to send back as the list's `error` filter - the two are matched exactly
// against the same stored field, so a group clicks through to the rows it
// counts. Two groups are the exception, and for the same reason: the filter
// treats an empty needle as no needle at all (`eventErrorTerm().empty("")`),
// so a group whose message is null - a row dead-lettered before any error was
// recorded - and a group whose message is the empty string both count real
// work that cannot be narrowed to. Both are kept rather than dropped: an
// operator has to see the work exists even where the page cannot filter to it.
//
// `type` is the SHORT display type, the same string the list rows carry, and
// is derived by the same `shortEventType` they go through - so a group always
// reads exactly as the rows it counts do, "audit" included.
const breakdownGroupSchema = Joi.object({
  error: Joi.string().allow("", null).required().example("No handler found"),
  // Always stated, never null: the group of rows that store no type at all is
  // the audit group, and it says so.
  type: Joi.string().required().example("case.status.updated"),
  count: Joi.number().integer().min(1).required(),
  firstAt: Joi.string().isoDate().allow(null).required(),
  lastAt: Joi.string().isoDate().allow(null).required(),
}).label("EventBreakdownGroup");

// Commonest first, capped at twenty groups: past that an operator is reading
// noise, and the long tail is reachable by filtering. Partial by design
// exactly as the list and the counts are - a source that could not be read
// contributes nothing and names itself in `sourceErrors`.
export const breakdownEventsResponseSchema = Joi.object({
  groups: Joi.array().items(breakdownGroupSchema).required(),
  sourceErrors: Joi.array().items(eventSourceErrorSchema).required(),
}).label("BreakdownEventsResponse");
