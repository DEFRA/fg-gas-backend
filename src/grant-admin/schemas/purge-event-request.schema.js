import Joi from "joi";
import {
  PURGE_NOTE_MAX,
  PURGE_REASON_CODES,
  PURGE_REASON_REQUIRING_NOTE,
} from "../../events/event-purge.js";

// `.empty()` treats a whitespace-only note, and an explicit null from a client
// that sends the key regardless, as absent: refused for `OTHER` and stored as
// null everywhere else.
export const purgeEventRequestSchema = Joi.object({
  reasonCode: Joi.string()
    .valid(...PURGE_REASON_CODES)
    .required()
    .example("BROKEN_PAYLOAD"),
  note: Joi.string()
    .trim()
    .max(PURGE_NOTE_MAX)
    .empty(Joi.valid("", null))
    .when("reasonCode", {
      is: PURGE_REASON_REQUIRING_NOTE,
      then: Joi.required(),
      otherwise: Joi.optional(),
    })
    .description(
      `At most ${PURGE_NOTE_MAX} characters, and required when the reason is ${PURGE_REASON_REQUIRING_NOTE}. Never personal data.`,
    ),
}).label("PurgeEventRequest");
