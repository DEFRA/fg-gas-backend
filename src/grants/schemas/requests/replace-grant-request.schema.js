import Joi from "joi";
import { action } from "../grant/action/action.js";
import { description } from "../grant/metadata/description.js";
import { startDate } from "../grant/metadata/start-date.js";
import { questions } from "../grant/questions.js";

export const replaceGrantRequestSchema = Joi.object({
  metadata: Joi.object({
    description,
    startDate,
  }).label("Metadata"),
  actions: Joi.array().items(action).unique("name").max(20).label("Actions"),
  questions,
})
  .options({
    presence: "required",
    stripUnknown: true,
  })
  .label("ReplaceGrantRequest");
