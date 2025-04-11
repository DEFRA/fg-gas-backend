import Joi from "joi";
import { questions } from "./schemas/questions.js";

export const actionName = Joi.string()
  .pattern(/^[a-z0-9-]+$/)
  .min(1)
  .max(30)
  .required()
  .example("action-name")
  .label("GrantActionName");

export const actionPayload = Joi.object({})
  .unknown(true)
  .required()
  .label("GrantActionPayload");

const action = Joi.object({
  name: actionName,
  method: Joi.string().valid("GET", "POST").required(),
  url: Joi.string()
    .uri()
    .max(3000)
    .required()
    .example("https://example.com/api/v1/action"),
}).label("GrantAction");

export const grantCode = Joi.string()
  .pattern(/^[a-z0-9-]+$/)
  .min(1)
  .max(500)
  .required()
  .example("test-code")
  .label("GrantCode");

export const Grant = Joi.object({
  code: grantCode,
  metadata: Joi.object({
    description: Joi.string().min(1).max(500).required(),
    startDate: Joi.date().required(),
  })
    .label("GrantMetadata")
    .required(),
  actions: Joi.array().items(action).max(20).required(),
  questions: questions.required(),
}).label("Grant");

export const clientRef = Joi.string()
  .pattern(/^[a-z0-9-]+$/)
  .example("ref-1234");

export const CreateApplicationRequest = Joi.object({
  metadata: Joi.object({
    clientRef,
    submittedAt: Joi.date().iso().optional(),
    sbi: Joi.string(),
    frn: Joi.string(),
    crn: Joi.string(),
    defraId: Joi.string(),
  }).label("ApplicationMetadata"),
  answers: Joi.object({}).unknown(true).label("Answers"),
})
  .options({ presence: "required" })
  .label("CreateApplicationRequest");

export const ValidationError = Joi.object({
  statusCode: Joi.number().example(400),
  error: Joi.string().example("Bad Request"),
  message: Joi.string().example("Grant code must be a valid code"),
  validation: Joi.object({
    keys: Joi.array().items(Joi.string().example("code")),
    source: Joi.string().example("payload"),
  }),
}).label("ValidationError");
