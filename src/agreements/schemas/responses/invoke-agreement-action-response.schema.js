import Joi from "joi";
import { agreementPageModelResponseSchema } from "./agreement-page-model-response.schema.js";

const validationError = Joi.object({
  name: Joi.string().required(),
  href: Joi.string().required(),
  message: Joi.string().required(),
}).label("AgreementActionValidationError");

export const invokeAgreementActionResponseSchema =
  agreementPageModelResponseSchema
    .keys({
      values: Joi.object().unknown(true).required(),
      errors: Joi.array().items(validationError).min(1).required(),
    })
    .label("InvalidAgreementActionResponse");
