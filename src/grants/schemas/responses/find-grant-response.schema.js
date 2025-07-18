import Joi from "joi";
import { action } from "../grant/action/action.js";
import { code } from "../grant/code.js";
import { description } from "../grant/metadata/description.js";
import { startDate } from "../grant/metadata/start-date.js";
import { questions } from "../grant/questions.js";

export const findGrantResponseSchema = Joi.object({
  code,
  metadata: Joi.object({
    description,
    startDate,
  }),
  actions: Joi.array().items(action),
  questions,
})
  .options({
    presence: "required",
    stripUnknown: true,
  })
  .label("FindGrantResponse");
