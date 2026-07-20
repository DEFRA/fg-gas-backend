import Joi from "joi";

const effectNames = [
  "snapshot",
  "publish",
  "callEndpoint",
  "createPaymentClaim",
];

const resolvedObject = Joi.alternatives().try(
  Joi.object().unknown(true),
  Joi.string().pattern(/^\$\./),
);

const snapshotParams = Joi.object({
  acceptedAt: Joi.string().optional(),
  claimId: Joi.string().optional(),
  correlationId: Joi.string().optional(),
  originalInvoiceNumber: Joi.string().optional(),
  payment: resolvedObject.optional(),
  supplementaryData: resolvedObject.optional(),
}).unknown(false);

const effectParams = Joi.when("name", {
  is: "snapshot",
  then: snapshotParams.optional(),
  otherwise: Joi.object().optional(),
});

const effect = Joi.object({
  name: Joi.string()
    .valid(...effectNames)
    .required(),
  output: Joi.string().optional(),
  destination: Joi.forbidden(),
  params: effectParams,
})
  .unknown(true)
  .label("Effect");

const effects = Joi.array().items(effect).optional().label("Effects");

const create = Joi.object({
  target: Joi.string().required(),
  effects,
})
  .required()
  .label("Create");

const requiredValidationField = Joi.object({
  name: Joi.string().required(),
  value: Joi.string().required(),
  href: Joi.string().required(),
  message: Joi.string().required(),
})
  .unknown(true)
  .label("RequiredValidationField");

const validation = Joi.object({
  page: Joi.string().required(),
  required: Joi.array().items(requiredValidationField).min(1).required(),
})
  .unknown(true)
  .label("Validation");

const actionTransition = Joi.object({
  target: Joi.string().required(),
  validation: validation.optional(),
  effects,
})
  .unknown(true)
  .label("ActionTransition");

const state = Joi.object({
  page: Joi.string().optional(),
  on: Joi.object().pattern(Joi.string(), actionTransition).optional(),
}).label("State");

const states = Joi.object()
  .pattern(Joi.string(), state)
  .min(1)
  .required()
  .label("States");

const component = Joi.object({
  component: Joi.string().required(),
})
  .unknown(true)
  .label("Component");

const pageHref = Joi.alternatives()
  .try(
    Joi.string(),
    Joi.object({
      urlTemplate: Joi.string().required(),
      params: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
    }),
  )
  .label("PageHref");

const pageAction = Joi.object({
  name: Joi.string().required(),
  method: Joi.string().valid("GET", "POST").required(),
  href: pageHref.required(),
  text: Joi.string().required(),
})
  .unknown(true)
  .label("PageAction");

const pageDefinition = Joi.object({
  title: Joi.string().required(),
  layout: Joi.string().valid("document").optional(),
  components: Joi.array().items(component).min(1).required(),
  actions: Joi.array().items(pageAction).optional(),
})
  .unknown(true)
  .label("Page");

const pages = Joi.object()
  .pattern(Joi.string(), pageDefinition)
  .min(1)
  .required()
  .label("Pages");

const endpoint = Joi.object({
  code: Joi.string().required(),
  method: Joi.string().required(),
  path: Joi.string().required(),
  service: Joi.string().required(),
})
  .unknown(true)
  .label("Endpoint");

const endpoints = Joi.array().items(endpoint).optional().label("Endpoints");

export const agreementDefinitionSchema = Joi.object({
  code: Joi.string().required(),
  configVersion: Joi.string().required(),
  agreementNumberPrefix: Joi.string().required(),
  endpoints,
  create,
  states,
  pages,
})
  .required()
  .label("AgreementDefinition");
