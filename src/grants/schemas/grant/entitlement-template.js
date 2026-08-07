import Joi from "joi";
import { questions } from "./questions.js";

const appliesTo = Joi.object({
  level: Joi.string().valid("AGREEMENT", "AGREEMENT_ITEM").required(),
  // Only meaningful when the entitlement is scoped to a single agreement item,
  // in which case it identifies which one.
  itemCode: Joi.string().allow(null).when("level", {
    is: "AGREEMENT_ITEM",
    then: Joi.string().required(),
  }),
}).label("EntitlementTemplateAppliesTo");

// Absent means the entitlement is not quantitative - it is held or not held,
// with no cap to record against it.
const limit = Joi.object({
  field: Joi.string().required(),
  unit: Joi.string().required(),
}).label("EntitlementTemplateLimit");

// Mirrors the component contract in
// src/agreements/schemas/agreement-definition.schema.js: the type is the only
// thing worth validating centrally, because every other property is
// presentational and belongs to whichever GOV.UK macro renders it. Kept as a
// local copy rather than an import - the agreements version is bound to that
// context by its JSONata references and effect handlers.
const component = Joi.object({
  component: Joi.string().required(),
  // Names the inputSchema property this component reads and writes.
  field: Joi.string().optional(),
})
  .unknown(true)
  .label("EntitlementTemplateFormComponent");

const form = Joi.object({
  content: Joi.array().items(component).min(1).required(),
})
  .unknown(true)
  .label("EntitlementTemplateForm");

// Absent means creating the entitlement does not move the application - several
// can be created without leaving the current position.
const onCreated = Joi.object({
  targetPosition: Joi.string().required(),
}).label("EntitlementTemplateOnCreated");

const creation = Joi.object({
  availableAt: Joi.array().items(Joi.string()).min(1).required(),
  onCreated: onCreated.optional(),
  // Same JSON Schema 2020-12 contract (and AJV validation) as phase questions.
  inputSchema: questions.required(),
  form: form.required(),
}).label("EntitlementTemplateCreation");

// Claiming is a later phase than creation and is not consulted to create an
// entitlement, so the whole block - and every rule inside it - is optional.
const claim = Joi.object({
  availableAt: Joi.array().items(Joi.string()).min(1).required(),
  limits: Joi.object({
    maximumClaims: Joi.number().integer().min(1).default(1),
    allowsPartialClaims: Joi.boolean().default(false),
  }).default(),
  onCreated: onCreated.optional(),
  // Absent means the entitlement is non-financial, or payment is arranged
  // downstream rather than triggered from here.
  payment: Joi.object({
    calculationAction: Joi.string().required(),
    trigger: Joi.string().required(),
  }).optional(),
}).label("EntitlementTemplateClaim");

// A limit is recorded from an answer the creation form collects, so the field
// it names has to be something inputSchema actually defines. Likewise every
// component bound to a field. Both are typos that would otherwise surface as a
// silently missing value at render or claim time rather than at ingest.
const findLimitFieldError = (limit, properties) => {
  if (!limit || properties.includes(limit.field)) {
    return null;
  }

  return `"limit.field" ("${limit.field}") does not match any property in "creation.inputSchema"`;
};

const findFormFieldError = (content, properties) => {
  const unknownField = content
    .map((c) => c.field)
    .filter(Boolean)
    .find((field) => !properties.includes(field));

  if (!unknownField) {
    return null;
  }

  return `"creation.form" field ("${unknownField}") does not match any property in "creation.inputSchema"`;
};

// Runs once the individual keys have validated, so creation and its required
// children are known to be present.
const assertFieldsExistInInputSchema = (template, helpers) => {
  const properties = Object.keys(
    template.creation.inputSchema.properties ?? {},
  );
  const error =
    findLimitFieldError(template.limit, properties) ??
    findFormFieldError(template.creation.form.content, properties);

  return error ? helpers.message({ custom: error }) : template;
};

export const entitlementTemplate = Joi.object({
  code: Joi.string().required(),
  name: Joi.string().required(),
  description: Joi.string().optional(),
  appliesTo: appliesTo.required(),
  limit: limit.optional(),
  creation: creation.required(),
  claim: claim.optional(),
})
  .custom(assertFieldsExistInInputSchema)
  .label("EntitlementTemplate");

export const entitlementTemplates = Joi.array()
  .items(entitlementTemplate)
  .unique("code")
  .label("EntitlementTemplates");
