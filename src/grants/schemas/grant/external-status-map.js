import Joi from "joi";

const externalStatus = Joi.object({
  // The inbound status from the source system (e.g. CW's fully-qualified
  // position, or AS codes like "offered"/"accepted").
  externalCode: Joi.string().required(),
  // Qualifier: this mapping is only active when the application's current
  // status matches. A bare status code (e.g. "STATUS_IN_REVIEW").
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
