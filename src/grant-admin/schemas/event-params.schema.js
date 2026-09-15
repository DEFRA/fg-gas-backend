import Joi from "joi";
import { OBJECT_ID_HEX } from "../../common/object-id-hex.js";
import { EVENT_BOXES, EVENT_SERVICES } from "./events-shared.schema.js";

// A malformed id is a 400 here, not a 500 from the ObjectId constructor.
export const eventParamsSchema = Joi.object({
  service: Joi.string()
    .valid(...EVENT_SERVICES)
    .required(),
  box: Joi.string()
    .valid(...EVENT_BOXES)
    .required(),
  id: Joi.string()
    .pattern(OBJECT_ID_HEX)
    .required()
    .example("665f1c2e9a1b2c3d4e5f6a7b")
    .description("24-character hex Mongo _id"),
}).label("EventParams");
