import Joi from "joi";

const externalStatus = Joi.object({
  code: Joi.string().required(),
  source: Joi.string().required(),
  mappedTo: Joi.string().required(),
})
  .unknown()
  .label("External Status");

const externalStage = Joi.object({
  code: Joi.string().required(),
  statuses: Joi.array().items(externalStatus).min(1).required(),
})
  .unknown()
  .label("External Stage");

const externalPhase = Joi.object({
  code: Joi.string().required(),
  stages: Joi.array().items(externalStage).min(1).required(),
})
  .unknown()
  .label("External Phase");

export const externalStatusMap = Joi.object({
  phases: Joi.array().items(externalPhase).min(1).required(),
})
  .unknown()
  .label("External Status Map");
