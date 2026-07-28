import Joi from "joi";
import { handlers } from "../services/effects/agreement-effect-runner.js";

const effect = Joi.object({
  name: Joi.string()
    .valid(...Object.keys(handlers))
    .required(),
  output: Joi.string().optional(),
  params: Joi.object().optional(),
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

const nestedComponents = Joi.array().items(Joi.link("#component")).min(1);

// Conditions and data references must be a reference or a JSONata expression
const reference = Joi.string().pattern(/^(jsonata:|\$\.|@\.)/, {
  name: "reference or jsonata: expression",
});

// A branch may be a single component or several
const branch = Joi.alternatives().try(
  Joi.link("#component"),
  Joi.array().items(Joi.link("#component")).min(1),
);

const genericComponent = Joi.object({
  component: Joi.string().required(),
  condition: reference.optional(),
})
  .unknown(true)
  .label("Component");

const conditionalComponent = Joi.object({
  component: Joi.string().required(),
  condition: reference.required(),
  whenTrue: branch.optional(),
  whenFalse: branch.optional(),
}).or("whenTrue", "whenFalse");

const repeatComponent = Joi.object({
  component: Joi.string().required(),
  condition: reference.optional(),
  itemsRef: reference.required(),
  items: nestedComponents.required(),
  beforeContent: nestedComponents.optional(),
  emptyContent: nestedComponents.optional(),
});

const templateComponent = Joi.object({
  component: Joi.string().required(),
  condition: reference.optional(),
  templateRef: reference.required(),
  templateKey: Joi.string().required(),
  dataRef: reference.optional(),
});

const containerComponent = Joi.object({
  component: Joi.string().required(),
  condition: reference.optional(),
  content: nestedComponents.required(),
});

const tableComponent = Joi.object({
  component: Joi.string().required(),
  condition: reference.optional(),
  rowsRef: reference.required(),
  rows: Joi.array().items(Joi.object()).min(1).required(),
}).unknown(true);

const component = Joi.alternatives()
  .conditional(".component", {
    switch: [
      { is: "conditional", then: conditionalComponent },
      { is: "repeat", then: repeatComponent },
      { is: "template", then: templateComponent },
      { is: "component-container", then: containerComponent },
      { is: "table", then: tableComponent },
    ],
    otherwise: genericComponent,
  })
  .id("component");

const templateContent = Joi.object({
  content: Joi.array().items(component).min(1).required(),
}).unknown(true);

const templates = Joi.object()
  .pattern(
    Joi.string(),
    Joi.object().pattern(Joi.string(), templateContent).min(1),
  )
  .optional()
  .label("Templates");

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
  templates,
})
  .required()
  .label("AgreementDefinition");
