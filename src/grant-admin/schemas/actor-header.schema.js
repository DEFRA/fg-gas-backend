import Joi from "joi";
import { decodeActor } from "../services/actor-header.js";

// Caseworking's cap on the same name, so a redrive it would refuse is a 400 here.
const ACTOR_MAX = 128;
// Room for that name percent-encoded: up to four UTF-8 bytes of `%XX` a character.
const ENCODED_CHARS_PER_CHARACTER = 12;
const ENCODED_MAX = "UTF-8''".length + ACTOR_MAX * ENCODED_CHARS_PER_CHARACTER;

const assertDecodedLength = (value, helpers) =>
  decodeActor(value).length > ACTOR_MAX
    ? helpers.error("actor.tooLong")
    : value;

const actorHeader = Joi.string()
  .trim()
  .max(ENCODED_MAX)
  .custom(assertDecodedLength)
  .messages({
    "actor.tooLong": `"x-actor" must be at most ${ACTOR_MAX} characters`,
  })
  .empty("");

export const actorHeaderSchema = Joi.object({
  "x-actor": actorHeader.optional(),
})
  .unknown(true)
  .label("ActorHeaders");

// A purge writes an audit event of its own, on both backends, and an anonymous
// one would record no operator at all - so the purge route insists on a name.
export const requiredActorHeaderSchema = Joi.object({
  "x-actor": actorHeader.required(),
})
  .unknown(true)
  .label("RequiredActorHeaders");
