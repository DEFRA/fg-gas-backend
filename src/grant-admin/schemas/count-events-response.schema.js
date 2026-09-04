import Joi from "joi";
import { EVENT_STATUSES } from "./find-events-query.schema.js";
import { eventSourceErrorSchema } from "./find-events-response.schema.js";

// All seven statuses, always, summed across every selected source. A status
// with no rows anywhere is a zero, never a missing key: the frontend renders
// one filter segment per status and a gap would render as a blank rather than
// as "none".
const counts = Joi.object(
  Object.fromEntries(
    EVENT_STATUSES.map((status) => [
      status,
      Joi.number().integer().min(0).required(),
    ]),
  ),
).label("EventStatusCounts");

// One block and its errors. There is deliberately no `total`: it was the sum
// of the seven numbers beside it, computed here and sent alongside them, which
// is a figure that can only ever agree with them or be a bug. The caller adds
// them up - see the events page's own total indicator.
//
// Partial by design, exactly as the list is: a source that could not be read
// contributes its zeros and names itself here, so the numbers stay renderable
// and the operator can see they are incomplete.
export const countEventsResponseSchema = Joi.object({
  counts: counts.required(),
  sourceErrors: Joi.array().items(eventSourceErrorSchema).required(),
}).label("CountEventsResponse");
