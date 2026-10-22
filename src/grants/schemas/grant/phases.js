import Joi from "joi";

const validFrom = Joi.object({
  code: Joi.string().required(),
  processes: Joi.array().items(Joi.string()).required(),
});

const status = Joi.object({
  code: Joi.string().required(),
  validFrom: Joi.array().items(validFrom),
  processes: Joi.array().items(Joi.string()),
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
  // Compiled with the answers validator when a definition is checked.
  questions: Joi.object().optional(),
})
  .unknown()
  .label("Phase");

export const phases = Joi.array()
  .items(phase)
  .min(1)
  .required()
  .label("Phases");
