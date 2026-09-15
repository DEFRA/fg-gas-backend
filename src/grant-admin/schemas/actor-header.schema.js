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

export const actorHeaderSchema = Joi.object({
  "x-actor": Joi.string()
    .trim()
    .max(ENCODED_MAX)
    .custom(assertDecodedLength)
    .messages({
      "actor.tooLong": `"x-actor" must be at most ${ACTOR_MAX} characters`,
    })
    .empty("")
    .optional(),
})
  .unknown(true)
  .label("ActorHeaders");
