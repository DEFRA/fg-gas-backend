import Joi from "joi";
import { agreementPageModelResponseSchema } from "./agreement-page-model-response.schema.js";

const transition = Joi.object({
  from: Joi.string().required(),
  action: Joi.string().required(),
  target: Joi.string().required(),
}).required();

const validTransitionResponse = Joi.object({
  valid: Joi.boolean().valid(true).required(),
  transition,
})
  .options({
    presence: "required",
    stripUnknown: true,
  })
  .label("ValidAgreementActionResponse");

const validationError = Joi.object({
  name: Joi.string().required(),
  href: Joi.string().required(),
  message: Joi.string().required(),
}).label("AgreementActionValidationError");

const validationFailureResponse = agreementPageModelResponseSchema
  .keys({
    values: Joi.object().unknown(true).required(),
    errors: Joi.array().items(validationError).min(1).required(),
  })
  .label("InvalidAgreementActionResponse");

export const invokeAgreementActionResponseSchema = Joi.alternatives()
  .try(validTransitionResponse, validationFailureResponse)
  .label("InvokeAgreementActionResponse");
