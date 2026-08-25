import Joi from "joi";
import { applicantSchema } from "../agreement-value.schema.js";
import { clientRef } from "../agreement/client-ref.js";
import { code } from "../agreement/code.js";
import { sbi } from "../agreement/sbi.js";

const accountDisplayApplicant = Joi.object({
  business: Joi.object({
    name: applicantSchema.extract("business.name"),
  }).required(),
  customer: Joi.object({
    name: Joi.object({
      first: applicantSchema.extract("customer.name.first"),
      last: applicantSchema.extract("customer.name.last"),
    }).required(),
  }).required(),
}).label("AgreementPageModelApplicant");

const component = Joi.object({ component: Joi.string().required() })
  .unknown(true)
  .label("AgreementPageModelComponent");

const action = Joi.object({
  name: Joi.string().required(),
  method: Joi.string().valid("GET", "POST").required(),
  text: Joi.string().required(),
  href: Joi.string().required(),
}).label("AgreementPageModelAction");

const section = Joi.object({
  id: Joi.string().required(),
  title: Joi.string().required(),
  components: Joi.array().items(component).required(),
}).label("AgreementPageModelSection");

const watermark = Joi.object({
  text: Joi.string().required(),
}).label("AgreementPageModelWatermark");

export const agreementPageModelResponseSchema = Joi.object({
  agreement: Joi.object({
    agreementNumber: Joi.string().required(),
    code: code.required(),
    clientRef: clientRef.required(),
    identifiers: Joi.object({ sbi: sbi.required() }).required(),
    state: Joi.string().required(),
    version: Joi.number().integer().min(1).required(),
    applicant: accountDisplayApplicant.optional(),
  }).required(),
  page: Joi.object({
    name: Joi.string().required(),
    title: Joi.string().required(),
    layout: Joi.string().valid("document").optional(),
    contents: Joi.boolean().optional(),
    print: Joi.boolean().optional(),
    watermark: watermark.optional(),
  }).required(),
  components: Joi.array().items(component).required(),
  sections: Joi.array().items(section).optional(),
  actions: Joi.array().items(action).required(),
})
  .options({ presence: "required", stripUnknown: true })
  .label("AgreementPageModelResponse");
