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

const componentLink = Joi.link("#renderComponent");
const childComponents = Joi.array().items(componentLink).min(1).required();
const forbiddenResolverFields = {
  actionId: Joi.forbidden(),
  condition: Joi.forbidden(),
  format: Joi.forbidden(),
  itemsRef: Joi.forbidden(),
  templateRef: Joi.forbidden(),
};

const gridColumn = Joi.object({
  component: Joi.string().valid("grid-column").required(),
  width: Joi.string().valid("two-thirds", "full").optional(),
  components: childComponents,
  ...forbiddenResolverFields,
}).label("AgreementPageModelGridColumn");

const gridRow = Joi.object({
  component: Joi.string().valid("grid-row").required(),
  components: Joi.array().items(gridColumn).min(1).required(),
  ...forbiddenResolverFields,
}).label("AgreementPageModelGridRow");

const form = Joi.object({
  component: Joi.string().valid("form").required(),
  method: Joi.string().valid("POST").required(),
  formAction: Joi.string().required(),
  hiddenFields: Joi.array().items(Joi.object().unknown(true)).required(),
  components: childComponents,
  ...forbiddenResolverFields,
}).label("AgreementPageModelForm");

const getButton = Joi.object({
  component: Joi.string().valid("button").required(),
  text: Joi.string().required(),
  href: Joi.string().required(),
  classes: Joi.string().optional(),
  submit: Joi.forbidden(),
  ...forbiddenResolverFields,
}).unknown(true);

const submitButton = Joi.object({
  component: Joi.string().valid("button").required(),
  text: Joi.string().required(),
  submit: Joi.boolean().valid(true).required(),
  classes: Joi.string().optional(),
  href: Joi.forbidden(),
  ...forbiddenResolverFields,
}).unknown(true);

const button = Joi.alternatives()
  .try(getButton, submitButton)
  .label("AgreementPageModelButton");

const displayComponent = Joi.object({
  component: Joi.string()
    .valid(
      "accordion",
      "checkboxes",
      "container",
      "description-list",
      "details",
      "heading",
      "line-break",
      "notification-banner",
      "ordered-list",
      "panel",
      "paragraph",
      "status",
      "summary-list",
      "table",
      "text",
      "unordered-list",
      "url",
      "warning-text",
    )
    .required(),
  ...forbiddenResolverFields,
})
  .unknown(true)
  .label("AgreementPageModelDisplayComponent");

const component = Joi.alternatives()
  .conditional(".component", {
    switch: [
      { is: "grid-row", then: gridRow },
      { is: "grid-column", then: gridColumn },
      { is: "form", then: form },
      { is: "button", then: button },
    ],
    otherwise: displayComponent,
  })
  .id("renderComponent");

const componentTree = Joi.array()
  .items(component)
  .custom((components, helpers) =>
    components.every(({ component: name }) => name === "grid-row")
      ? components
      : helpers.error("array.explicitComponentTree"),
  )
  .messages({
    "array.explicitComponentTree":
      "{{#label}} must use grid-row components at the root",
  })
  .required();

const section = Joi.object({
  id: Joi.string().required(),
  title: Joi.string().required(),
  components: componentTree,
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
  components: componentTree,
  sections: Joi.array().items(section).optional(),
})
  .options({ presence: "required" })
  .label("AgreementPageModelResponse");
