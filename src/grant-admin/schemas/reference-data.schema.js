import Joi from "joi";
import { code } from "./code.js";

// Grant Admin validates shape only; Grants decides what an item may hold.
export const referenceDataParamsSchema = Joi.object({
  code: code.required(),
  name: Joi.string().required(),
}).label("ReferenceDataParams");

export const referenceDataItemParamsSchema = referenceDataParamsSchema
  .keys({ itemCode: Joi.string().required() })
  .label("ReferenceDataItemParams");

export const addReferenceDataItemRequestSchema = Joi.object({
  code: Joi.string().allow("").required(),
  description: Joi.string().allow("").required(),
})
  .unknown(false)
  .label("AddReferenceDataItemRequest");

export const changeReferenceDataItemRequestSchema = Joi.object({
  description: Joi.string().allow("").required(),
})
  .unknown(false)
  .label("ChangeReferenceDataItemRequest");

const item = Joi.object({
  code: Joi.string().required(),
  description: Joi.string().required(),
});

export const dbReferenceDataResponseSchema = Joi.object({
  name: Joi.string().required(),
  items: Joi.array().items(item).required(),
  updatedAt: Joi.string().allow(null).required(),
}).label("DbReferenceDataResponse");

const summary = {
  name: Joi.string().required(),
  source: Joi.string().valid("inline", "db", "endpoint").required(),
  editable: Joi.boolean().required(),
  service: Joi.string().optional(),
};

// An endpoint set lists its service but no items: those are fetched only when
// the set itself is viewed.
export const grantReferenceDataResponseSchema = Joi.object({
  grantCode: Joi.string().required(),
  referenceData: Joi.array()
    .items(
      Joi.object({ ...summary, items: Joi.array().items(item).optional() }),
    )
    .required(),
}).label("GrantReferenceDataResponse");

export const viewReferenceDataResponseSchema = Joi.object({
  ...summary,
  items: Joi.array().items(item).required(),
}).label("ViewReferenceDataResponse");
