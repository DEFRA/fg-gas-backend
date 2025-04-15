import Joi from "joi";
import { code } from "../grant/code.js";
import { description } from "../grant/metadata/description.js";
import { startDate } from "../grant/metadata/start-date.js";
import { questions } from "../grant/questions.js";
import { action } from "../grant/action/action.js";

export const createGrantRequest = Joi.object({
  code,
  questions,
  metadata: Joi.object({
    description,
    startDate,
  }).label("Metadata"),
  actions: Joi.array().items(action).unique("name").max(20).label("Actions"),
})
  .options({
    presence: "required",
  })
  .label("CreateGrantRequest");
