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

// GAS is the single enum authority: the admin frontend forwards `status` and
// `service` unvalidated and renders the 400 from here as its in-page alert.
// No status and no service means All: every status, both services, both boxes,
// domain and audit rows. The cursor is a keyset position, so it stays decodable
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
}).label("FindEventsQuery");
