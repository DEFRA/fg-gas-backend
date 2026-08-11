import Joi from "joi";

const processes = Joi.array().items(Joi.string()).optional().label("Processes");

const endpointProcessDefinition = Joi.object({
  type: Joi.string().valid("endpoint").required(),
  endpoint: Joi.object({
    method: Joi.string().valid("GET", "POST").required(),
    path: Joi.string().required(),
    service: Joi.string().required(),
  }).required(),
  request: Joi.object({
    body: Joi.object().unknown(true).required(),
  }).required(),
  output: Joi.object().min(1).unknown(true).required(),
}).label("EndpointProcessDefinition");

const handlerProcessDefinition = Joi.object({
  type: Joi.string().valid("handler").required(),
  input: Joi.object().unknown(true).required(),
}).label("HandlerProcessDefinition");

const unknownProcessDefinition = Joi.object({
  type: Joi.string().valid("endpoint", "handler").required(),
}).unknown(true);

const processDefinition = Joi.alternatives()
  .conditional(".type", {
    switch: [
      { is: "endpoint", then: endpointProcessDefinition },
      { is: "handler", then: handlerProcessDefinition },
    ],
    otherwise: unknownProcessDefinition,
  })
  .label("ProcessDefinition");

const processDefinitions = Joi.object()
  .pattern(Joi.string(), processDefinition)
  .optional()
  .label("ProcessDefinitions");

const create = Joi.object({
  target: Joi.string().required(),
  application: Joi.any().required(),
  values: Joi.object().min(1).unknown(true).optional(),
  effects: Joi.forbidden(),
  processes,
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
  effects: Joi.forbidden(),
  processes,
})
  .unknown(true)
  .label("ActionTransition");

const state = Joi.object({
  page: Joi.string().optional(),
  processes,
  on: Joi.object().pattern(Joi.string(), actionTransition).optional(),
}).label("State");

const states = Joi.object()
  .pattern(Joi.string(), state)
  .min(1)
  .required()
  .label("States");

// Resolved at validation time against the "component" id below, so components
// can nest inside each other without the schema referencing itself too early.
const componentLink = Joi.link("#component");

const nestedComponents = Joi.array().items(componentLink).min(1);

// Conditions and data references must be a lone reference or a JSONata
// expression. Anything in between, such as "$.price * $.quantity", is rejected
// here rather than left to resolve as interpolated text at render time. A lone
// reference is checked by its characters rather than its grammar: an operator
// or a space is what separates an expression from a reference, and resolving
// is what parses the reference properly.
const reference = Joi.string().pattern(/^(?:jsonata:.+|[$@]\.[\w$.[\]]+)$/s, {
  name: "reference or jsonata: expression",
});

// A branch may be a single component or several
const branch = Joi.alternatives().try(componentLink, nestedComponents);

const pageHref = Joi.alternatives()
  .try(
    Joi.string(),
    Joi.object({
      urlTemplate: Joi.string().required(),
      params: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
    }),
  )
  .label("PageHref");

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

const urlComponent = Joi.object({
  component: Joi.string().valid("url").required(),
  condition: reference.optional(),
  href: pageHref.required(),
  text: Joi.string().required(),
}).unknown(true);

const component = Joi.alternatives()
  .conditional(".component", {
    switch: [
      { is: "conditional", then: conditionalComponent },
      { is: "repeat", then: repeatComponent },
      { is: "template", then: templateComponent },
      { is: "component-container", then: containerComponent },
      { is: "table", then: tableComponent },
      { is: "url", then: urlComponent },
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

const pageAction = Joi.object({
  name: Joi.string().required(),
  method: Joi.string().valid("GET", "POST").required(),
  href: pageHref.required(),
  text: Joi.string().required(),
})
  .unknown(true)
  .label("PageAction");

const sectionId = Joi.string()
  .pattern(/^[a-z][a-z0-9-]*$/)
  .label("SectionId");

const documentSection = Joi.object({
  id: sectionId.required(),
  title: Joi.string().required(),
  condition: reference.optional(),
  components: Joi.array().items(component).min(1).required(),
}).label("DocumentSection");

const watermark = Joi.object({
  condition: reference.optional(),
  text: Joi.string().required(),
}).label("Watermark");

const pageDefinition = Joi.object({
  title: Joi.string().required(),
  layout: Joi.string().valid("document").optional(),
  contents: Joi.boolean().optional(),
  print: Joi.boolean().optional(),
  watermark: watermark.optional(),
  components: Joi.array().items(component).min(1).required(),
  processes: Joi.forbidden(),
  sections: Joi.array().items(documentSection).min(1).unique("id").optional(),
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
  processDefinitions,
  create,
  states,
  pages,
  templates,
})
  .required()
  .label("AgreementDefinition");
