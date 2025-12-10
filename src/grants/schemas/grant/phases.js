import Joi from "joi";
import { questions } from "./questions.js";

const validFrom = Joi.object({
  code: Joi.string().required(),
  processes: Joi.array().items(Joi.string()).required(),
});

const status = Joi.object({
  code: Joi.string().required(),
  validFrom: Joi.array().items(validFrom).optional(),
})
  .unknown()
  .label("Status");

const stage = Joi.object({
  code: Joi.string().required(),
  statuses: Joi.array().items(status).min(1).required(),
})
  .unknown()
  .label("Stage");

const phase = Joi.object({
  code: Joi.string().required(),
  stages: Joi.array().items(stage).min(1).required(),
  questions: questions.optional(),
})
  .unknown()
  .label("Phase");

export const phases = Joi.array()
  .items(phase)
  .min(1)
  .required()
  .label("Phases");
