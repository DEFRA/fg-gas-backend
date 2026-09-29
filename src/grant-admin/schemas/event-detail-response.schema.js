import Joi from "joi";
import {
  eventLastEditSchema,
  eventLastPurgeSchema,
  eventLastRedriveSchema,
  eventRowWithAttemptsSchema,
} from "./events-shared.schema.js";

const isoOrNull = Joi.string().isoDate().allow(null).required();

const eventAttemptSchema = Joi.object({
  at: Joi.string().isoDate().allow(null).required(),
  name: Joi.string().required().example("ClaimExpired"),
  message: Joi.string().allow("").required(),
  stack: Joi.string().allow(null).required(),
}).label("EventAttempt");

// `claimedBy` is a live claim token and must never be returned.
export const eventDetailResponseSchema = eventRowWithAttemptsSchema
  .keys({
    payload: Joi.object().unknown(true).allow(null).required(),
    // Null where the owning service cannot edit a payload: the admin gates its
    // Edit button on it, and posts it back as the edit's revision.
    payloadRevision: Joi.number().integer().min(0).allow(null).required(),
    // False when saving an edit would turn a BSON value into its JSON text;
    // null when the owning service cannot tell.
    payloadIsPlainJson: Joi.boolean().allow(null).required(),
    lastEdit: eventLastEditSchema.allow(null).required(),
    originalPayload: Joi.object().unknown(true).allow(null).required(),
    // Null on older outbox rows written before one was stored.
    segregationRef: Joi.string().allow(null).required(),
    traceId: Joi.string()
      .allow(null)
      .required()
      .example("4bf92f3577b34da6a3ce929d0e0e4736"),
    completionDate: isoOrNull,
    expiresAt: isoOrNull,
    lastResubmissionDate: isoOrNull,
    claimedBy: Joi.any().forbidden(),
    attemptHistory: Joi.array().items(eventAttemptSchema).required(),
    lastRedrive: eventLastRedriveSchema.allow(null).required(),
    lastPurge: eventLastPurgeSchema.allow(null).required(),
    // Present only where a purge is possible: the admin gates its button on
    // it. Null on anything but a dead letter.
    purgeDeletionDate: isoOrNull,
  })
  .label("EventDetail");
