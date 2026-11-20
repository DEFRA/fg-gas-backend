import Joi from "joi";

const MAX_SETS = 50;
const MAX_ITEMS = 1000;
const MAX_ENDPOINTS = 20;

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

const output = Joi.object({
  items: Joi.any().required(),
}).label("ReferenceDataOutput");

// The same shape as an agreement definition's endpoints: the address comes from
// {service}_URL, never from the published definition. {name} in the path is
// the name of the list being read, so one endpoint can serve several lists.
export const grantEndpoint = Joi.object({
  code: Joi.string()
    .pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(64)
    .required(),
  method: Joi.string().valid("GET").required(),
  path: Joi.string().pattern(/^\//).required(),
  service: Joi.string()
    .pattern(/^[A-Z][A-Z0-9_]*$/)
    .required(),
  output: output.optional(),
}).label("Endpoint");

export const endpoints = Joi.array()
  .items(grantEndpoint)
  .unique("code")
  .max(MAX_ENDPOINTS)
  .label("Endpoints");

// Names one of the grant's endpoints. Its own output overrides the endpoint's.
const endpointSource = Joi.object({
  type: Joi.string().valid("endpoint").required(),
  endpoint: Joi.string().required(),
  output: output.optional(),
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
