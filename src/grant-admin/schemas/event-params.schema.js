import Joi from "joi";
import { EVENT_SERVICES } from "./find-events-query.schema.js";

export const EVENT_BOXES = ["inbox", "outbox"];

const OBJECT_ID = /^[0-9a-f]{24}$/i;

// Addresses exactly one row: which service owns it, which of its two boxes it
// is in, and its Mongo `_id` as the list already returns it. The id is
// validated as 24 hex characters so a malformed one is a 400 before any query
// or Caseworking call, rather than an ObjectId constructor throwing a 500.
export const eventParamsSchema = Joi.object({
  service: Joi.string()
    .valid(...EVENT_SERVICES)
    .required(),
  box: Joi.string()
    .valid(...EVENT_BOXES)
    .required(),
  id: Joi.string()
    .pattern(OBJECT_ID)
    .required()
    .example("665f1c2e9a1b2c3d4e5f6a7b")
    .description("24-character hex Mongo _id"),
}).label("EventParams");
