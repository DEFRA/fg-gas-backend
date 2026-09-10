import Joi from "joi";
import { EVENT_STATUSES } from "./find-events-query.schema.js";

// All six statuses, always: a status with no rows is a zero, never a missing
// key, or the frontend renders a blank rather than "none". Deliberately no
// `total` - a figure that can only ever agree with the six beside it or be a
// bug; the caller adds them up. A source the counts could not read is already
// named in the page's `sourceErrors`, not a second time here.
export const eventStatusCountsSchema = Joi.object(
  Object.fromEntries(
    EVENT_STATUSES.map((status) => [
      status,
      Joi.number().integer().min(0).required(),
    ]),
  ),
).label("EventStatusCounts");
