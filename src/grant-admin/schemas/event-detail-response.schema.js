import Joi from "joi";
import { RECORD_KINDS } from "../services/record-kinds.js";
import { nullableIso } from "./admin-record.schema.js";
import {
  eventLastEditSchema,
  eventLastPurgeSchema,
  eventLastRedriveSchema,
  eventRowWithAttemptsSchema,
} from "./events-shared.schema.js";

const eventAttemptSchema = Joi.object({
  at: nullableIso,
  name: Joi.string().required().example("ClaimExpired"),
  message: Joi.string().allow("").required(),
  stack: Joi.string().allow(null).required(),
}).label("EventAttempt");

const atSchema = Joi.string().isoDate().allow(null).required();
const bySchema = Joi.string().required().example("System");
const noteSchema = Joi.string().allow(null, "").required();
const payloadImageSchema = Joi.object().unknown(true).allow(null).required();

const historyEntrySchemas = {
  received: { at: atSchema },
  attempt: {
    at: atSchema,
    number: Joi.number().integer().min(1).required(),
    name: Joi.string().required().example("ClaimExpired"),
    message: Joi.string().allow("").required(),
    stack: Joi.string().allow(null).required(),
  },
  "dead-lettered": { at: atSchema },
  purged: {
    at: atSchema,
    by: bySchema,
    reasonCode: Joi.string().allow("").required().example("BROKEN_PAYLOAD"),
    note: noteSchema,
  },
  // Both null where the edit's before-image was not kept.
  "payload-edited": {
    at: atSchema,
    by: bySchema,
    note: noteSchema,
    before: payloadImageSchema,
    after: payloadImageSchema,
  },
  redriven: { at: atSchema, by: bySchema },
  delivered: { at: atSchema },
};

const eventHistoryEntrySchema = Joi.alternatives()
  .conditional(".kind", {
    switch: Object.entries(historyEntrySchemas).map(([kind, keys]) => ({
      is: kind,
      then: Joi.object({ kind: Joi.string().valid(kind).required(), ...keys }),
    })),
    otherwise: Joi.forbidden(),
  })
  .label("EventHistoryEntry");

// `claimedBy` is a live claim token and must never be returned.
export const eventDetailResponseSchema = eventRowWithAttemptsSchema
  .keys({
    eventType: Joi.string().allow(null).required().example("UpdateCaseStatus"),
    errorKey: Joi.string().allow(null).required().example("No error recorded"),
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
    completionDate: nullableIso,
    expiresAt: nullableIso,
    lastResubmissionDate: nullableIso,
    claimedBy: Joi.any().forbidden(),
    attemptHistory: Joi.array().items(eventAttemptSchema).required(),
    lastRedrive: eventLastRedriveSchema.allow(null).required(),
    // Newest first.
    history: Joi.array().items(eventHistoryEntrySchema).required(),
    lastPurge: eventLastPurgeSchema.allow(null).required(),
    // Present only where a purge is possible: the admin gates its button on
    // it. Null on anything but a dead letter.
    purgeDeletionDate: nullableIso,
    purgeIsFinal: Joi.boolean().optional(),
    // The one record this event belongs to, where its owning service has it.
    record: Joi.object({
      kind: Joi.string()
        .valid(...Object.values(RECORD_KINDS))
        .required(),
      code: Joi.string().required(),
      ref: Joi.string().required(),
    })
      .allow(null)
      .required()
      .label("EventRecord"),
    // What "Related" searches the events for; null on an audit row.
    searchRef: Joi.string().allow(null).required(),
  })
  .label("EventDetail");
