import Joi from "joi";

const actionName = Joi.string()
  .pattern(/^[a-z0-9-]+$/)
  .min(1)
  .max(30)
  .required();

const actionPayload = Joi.object({}).unknown(true).required();

const action = Joi.object({
  name: actionName,
  method: Joi.string().valid("GET", "POST").required(),
  url: Joi.string().uri().max(3000).required(),
});

const code = Joi.string()
  .pattern(/^[a-z0-9-]+$/)
  .min(1)
  .max(500)
  .required();

const question = Joi.object({});

const createGrant = Joi.object({
  code,
  metadata: Joi.object({
    description: Joi.string().min(1).max(500).required(),
    startDate: Joi.date().required(),
  }),
  questions: Joi.array().items(question).required(),
  actions: Joi.array().items(action).max(20).required(),
});

export const schemas = {
  code,
  actionName,
  actionPayload,
  createGrant,
};
