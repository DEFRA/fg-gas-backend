import Joi from "joi";
import { EVENT_STATUSES } from "../../events/status-counts.js";

// All six statuses always, so a status with no rows is a zero, not a blank.
export const eventStatusCountsSchema = Joi.object(
  Object.fromEntries(
    EVENT_STATUSES.map((status) => [
      status,
      Joi.number().integer().min(0).required(),
    ]),
  ),
).label("EventStatusCounts");
