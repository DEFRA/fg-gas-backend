import Joi from "joi";
import { code } from "../grant/code.js";
import { description } from "../grant/metadata/description.js";
import { action } from "../grant/action/action.js";
import { questions } from "../grant/questions.js";
import { startDate } from "../grant/metadata/start-date.js";

export const getGrantResponse = Joi.object({
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
  })
  .label("GetGrantResponse");
