import Joi from "joi";

const fieldSchema = Joi.object({
  key: Joi.string().valid("sbi", "crn").required(),
  label: Joi.string().required(),
  value: Joi.string().allow("").required(),
  hint: Joi.string().required(),
  error: Joi.string(),
}).label("AllowListField");

const errorSummaryItemSchema = Joi.object({
  text: Joi.string().required(),
  href: Joi.string().required(),
  attributes: Joi.object({
    "data-error-line": Joi.number().integer().required(),
  }).required(),
}).label("AllowListErrorSummaryItem");

export const allowListViewSchema = Joi.object({
  sbi: fieldSchema.required(),
  crn: fieldSchema.required(),
  errorSummary: Joi.array().items(errorSummaryItemSchema).required(),
})
  .unknown(false)
  .required()
  .label("AllowListView");
