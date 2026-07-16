import Joi from "joi";
import { clientRef } from "../agreement/client-ref.js";
import { code } from "../agreement/code.js";
import { sbi } from "../agreement/sbi.js";

const component = Joi.object({
  component: Joi.string().required(),
})
  .unknown(true)
  .label("CurrentAgreementPageComponent");

const action = Joi.object({
  text: Joi.string().required(),
  href: Joi.string().required(),
}).label("CurrentAgreementPageAction");

export const getCurrentAgreementPageResponseSchema = Joi.object({
  agreementNumber: Joi.string().required(),
  code: code.required(),
  clientRef: clientRef.required(),
  sbi: sbi.required(),
  state: Joi.string().required(),
  page: Joi.object({
    name: Joi.string().required(),
    title: Joi.string().required(),
    mode: Joi.string().required(),
  }).required(),
  components: Joi.array().items(component).required(),
  actions: Joi.array().items(action).required(),
})
  .options({
    presence: "required",
    stripUnknown: true,
  })
  .label("GetCurrentAgreementPageResponse");
