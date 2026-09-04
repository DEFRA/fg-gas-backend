import Joi from "joi";
import { eventSourceErrorSchema } from "./find-events-response.schema.js";

// One group of dead letters that failed the same way on the same event type,
// summed across every selected source.
//
// `error` is the stored `lastError.message` VERBATIM, and is the exact value
// to send back as the list's `error` filter - the two are matched exactly
// against the same stored field, so a group is always clickable through to the
// rows it counts. Null for rows dead-lettered before any error was recorded (a
// message with no segregationRef is killed outright), and that null group is
// deliberately kept rather than dropped: it is real work an operator must see.
//
// `type` is the SHORT display type, the same string the list rows carry
// ("case.status.updated", "audit · GRANT.REPLACE_GRANT", or "-").
const breakdownGroupSchema = Joi.object({
  error: Joi.string().allow("", null).required().example("No handler found"),
  // Null for the group of rows that carry no stored type at all - an audit
  // record is not a CloudEvent and has none to state.
  type: Joi.string()
    .allow(null)
    .required()
    .example("case.status.updated"),
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
