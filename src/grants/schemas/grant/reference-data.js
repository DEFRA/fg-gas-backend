import Joi from "joi";

const MAX_SETS = 50;
const MAX_ITEMS = 1000;

export const referenceDataName = Joi.string()
  .pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(64)
  .label("ReferenceDataName");

export const referenceDataItemCode = Joi.string()
  .trim()
  .pattern(/^[A-Za-z0-9_-]+$/)
  .max(64)
  .messages({
    "string.pattern.base":
      '"code" must contain only letters, numbers, hyphens and underscores',
  })
  .label("code");

export const referenceDataItemDescription = Joi.string()
  .trim()
  .max(256)
  .label("description");

export const referenceDataItem = Joi.object({
  code: referenceDataItemCode.required(),
  description: referenceDataItemDescription.required(),
}).label("ReferenceDataItem");

const inlineSource = Joi.object({
  type: Joi.string().valid("inline").required(),
  items: Joi.array()
    .items(referenceDataItem)
    .unique("code")
    .min(1)
    .max(MAX_ITEMS)
    .required(),
}).label("InlineReferenceDataSource");

const dbSource = Joi.object({
  type: Joi.string().valid("db").required(),
}).label("DbReferenceDataSource");

// The same named-service shape as an agreement's endpoint process: the
// address comes from {service}_URL, never from the published definition.
const endpointSource = Joi.object({
  type: Joi.string().valid("endpoint").required(),
  endpoint: Joi.object({
    method: Joi.string().valid("GET").required(),
    path: Joi.string().pattern(/^\//).required(),
    service: Joi.string()
      .pattern(/^[A-Z][A-Z0-9_]*$/)
      .required(),
  }).required(),
  output: Joi.object({
    items: Joi.any().required(),
  }).required(),
}).label("EndpointReferenceDataSource");

const source = Joi.alternatives()
  .conditional(".type", {
    switch: [
      { is: "inline", then: inlineSource },
      { is: "db", then: dbSource },
      { is: "endpoint", then: endpointSource },
    ],
    otherwise: Joi.object({
      type: Joi.string().valid("inline", "db", "endpoint").required(),
    }).unknown(),
  })
  .label("ReferenceDataSource");

export const referenceData = Joi.array()
  .items(
    Joi.object({
      name: referenceDataName.required(),
      source: source.required(),
    }).label("ReferenceDataDeclaration"),
  )
  .unique("name")
  .max(MAX_SETS)
  .label("ReferenceData");
