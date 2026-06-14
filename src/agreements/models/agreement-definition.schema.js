import Joi from "joi";

const agreementImplementations = {
  CONFIG: "config",
  LEGACY: "legacy",
};

const agreementCommandNames = ["create"];

const agreementCommandRoutes = ["internal", "legacy"];

const actionStepTypes = [
  "callEndpoint",
  "createPaymentClaim",
  "emitLifecycleEvent",
  "recordTransition",
];

const nonEmptyString = Joi.string().trim().min(1);

const endpointSchema = Joi.object({
  code: nonEmptyString.required(),
  method: nonEmptyString.required(),
  path: nonEmptyString.required(),
  service: nonEmptyString.required(),
}).unknown(false);

const endpointReferenceSchema = Joi.alternatives().try(
  nonEmptyString,
  Joi.object({
    code: nonEmptyString.required(),
    endpointParams: Joi.object().optional(),
  }).unknown(false),
);

const actionTargetSchema = Joi.object({
  dataType: Joi.string().valid("ARRAY", "OBJECT").required(),
  key: Joi.when("dataType", {
    is: "OBJECT",
    otherwise: nonEmptyString.optional(),
    then: nonEmptyString.required(),
  }),
  place: Joi.string().valid("append").required(),
  targetNode: nonEmptyString.required(),
}).unknown(false);

const pathOutputSchema = Joi.object({
  path: nonEmptyString.required(),
  place: Joi.string().valid("merge", "replace").required(),
  select: nonEmptyString.optional(),
}).unknown(false);

const targetOutputSchema = Joi.object({
  select: nonEmptyString.optional(),
  target: actionTargetSchema.required(),
}).unknown(false);

const stepOutputSchema = Joi.alternatives().try(
  pathOutputSchema,
  targetOutputSchema,
);

const paymentClaimLineItemTypeSchema = Joi.object({
  descriptionTemplate: nonEmptyString.required(),
  idField: nonEmptyString.required(),
  itemsPath: nonEmptyString.required(),
  schemeCodePath: nonEmptyString.required(),
}).unknown(false);

const invoiceNumberSchema = Joi.object({
  requestPadding: Joi.number().integer().min(1).required(),
  requestPrefix: Joi.string().allow("").required(),
  suffix: nonEmptyString.required(),
}).unknown(false);

const paymentClaimSchema = Joi.object({
  defaultCurrency: nonEmptyString.required(),
  deliveryBody: nonEmptyString.required(),
  invoiceNumber: invoiceNumberSchema.required(),
  lineItemTypes: Joi.array()
    .items(paymentClaimLineItemTypeSchema)
    .min(1)
    .required(),
  marketingYear: Joi.alternatives()
    .try(Joi.string().valid("currentYear"), Joi.string().pattern(/^\d{4}$/))
    .required(),
  paymentRequestNumber: Joi.number().integer().min(1).required(),
  scheme: nonEmptyString.required(),
  sourceSystem: nonEmptyString.required(),
}).unknown(false);

const paymentSchema = Joi.object({
  claim: paymentClaimSchema.optional(),
}).unknown(false);

const stepObjectSchema = (stepTypes) =>
  Joi.object({
    changedBy: nonEmptyString.optional(),
    changeType: nonEmptyString.optional(),
    endpoint: endpointReferenceSchema.optional(),
    fromStatus: nonEmptyString.optional(),
    itemPatch: Joi.object().unknown(true).optional(),
    output: stepOutputSchema.optional(),
    payment: nonEmptyString.optional(),
    paymentClaim: paymentClaimSchema.optional(),
    toStatus: nonEmptyString.optional(),
    type: Joi.string()
      .valid(...stepTypes)
      .required(),
  }).unknown(false);

const stepSchema = (stepTypes) =>
  Joi.alternatives().try(
    Joi.string().valid(...stepTypes),
    stepObjectSchema(stepTypes),
  );

const actionSchema = Joi.object({
  changedBy: nonEmptyString.optional(),
  changeType: nonEmptyString.optional(),
  fromStatus: nonEmptyString.required(),
  paymentClaim: paymentClaimSchema.optional(),
  steps: Joi.array().items(stepSchema(actionStepTypes)).min(1).required(),
  target: nonEmptyString.optional(),
  toStatus: nonEmptyString.required(),
}).unknown(false);

const commandSchema = Joi.object({
  route: Joi.string()
    .valid(...agreementCommandRoutes)
    .required(),
}).unknown(false);

const commandsSchema = Joi.object(
  Object.fromEntries(
    agreementCommandNames.map((commandName) => [
      commandName,
      commandSchema.optional(),
    ]),
  ),
).unknown(false);

const lifecycleSchema = Joi.object({
  actions: Joi.object().pattern(nonEmptyString, actionSchema).min(1).required(),
  changedBy: nonEmptyString.required(),
  fromStatus: nonEmptyString.allow(null).required(),
  initialChangeType: nonEmptyString.required(),
  initialStatus: nonEmptyString.required(),
}).unknown(false);

const agreementNumberSchema = Joi.object({
  prefix: nonEmptyString.required(),
  randomDigits: Joi.number().integer().min(1).required(),
  uniquenessScope: nonEmptyString.required(),
}).unknown(false);

const getStepType = (step) => (typeof step === "string" ? step : step.type);

const hasPaymentClaim = ({ action, definition, step }) =>
  Boolean(
    step.paymentClaim ?? action.paymentClaim ?? definition.payment?.claim,
  );

const hasMissingStepConfig = ({ action, definition, stepType, hasConfig }) =>
  action.steps.some(
    (step) =>
      getStepType(step) === stepType &&
      !hasConfig({ action, definition, step }),
  );

const hasMissingPaymentClaim = (definition) =>
  Object.values(definition.lifecycle.actions).some((action) =>
    hasMissingStepConfig({
      action,
      definition,
      hasConfig: hasPaymentClaim,
      stepType: "createPaymentClaim",
    }),
  );

const getEndpointCode = (step) =>
  typeof step.endpoint === "string" ? step.endpoint : step.endpoint?.code;

const hasEndpoint = ({ definition, step }) =>
  definition.endpoints?.some(
    (endpoint) => endpoint.code === getEndpointCode(step),
  );

const hasMissingEndpoint = (definition) =>
  Object.values(definition.lifecycle.actions).some((action) =>
    hasMissingStepConfig({
      action,
      definition,
      hasConfig: hasEndpoint,
      stepType: "callEndpoint",
    }),
  );

const getCrossCheckError = (definition) => {
  if (hasMissingEndpoint(definition)) {
    return "agreementDefinition.missingEndpoint";
  }

  if (hasMissingPaymentClaim(definition)) {
    return "agreementDefinition.missingPaymentClaim";
  }
};

const validateAgreementDefinitionReferences = (definition, helpers) => {
  const error = getCrossCheckError(definition);

  if (error) {
    return helpers.error(error);
  }

  return definition;
};

const configAgreementDefinitionSchema = Joi.object({
  agreementCode: nonEmptyString.required(),
  agreementNumber: agreementNumberSchema.required(),
  commands: commandsSchema.optional(),
  configVersion: nonEmptyString.required(),
  endpoints: Joi.array().items(endpointSchema).unique("code").optional(),
  implementation: Joi.string()
    .valid(agreementImplementations.CONFIG)
    .required(),
  lifecycle: lifecycleSchema.required(),
  payment: paymentSchema.optional(),
})
  .custom(validateAgreementDefinitionReferences)
  .messages({
    "agreementDefinition.missingEndpoint":
      "callEndpoint steps require an endpoint matching step.endpoint.code",
    "agreementDefinition.missingPaymentClaim":
      "createPaymentClaim steps require payment.claim, action.paymentClaim, or step.paymentClaim",
  })
  .unknown(false);

const legacyAgreementDefinitionSchema = Joi.object({
  agreementCode: nonEmptyString.required(),
  implementation: Joi.string()
    .valid(agreementImplementations.LEGACY)
    .required(),
}).unknown(false);

export const agreementDefinitionSchema = Joi.alternatives().try(
  configAgreementDefinitionSchema,
  legacyAgreementDefinitionSchema,
);

const schemasByImplementation = {
  [agreementImplementations.CONFIG]: configAgreementDefinitionSchema,
  [agreementImplementations.LEGACY]: legacyAgreementDefinitionSchema,
};

export const validateAgreementDefinition = (definition) =>
  (
    schemasByImplementation[definition?.implementation] ??
    agreementDefinitionSchema
  ).validate(definition, {
    abortEarly: false,
    allowUnknown: false,
    stripUnknown: false,
  });

const formatValidationErrors = (details) =>
  details.map(({ message }) => message).join(", ");

export const assertValidAgreementDefinition = ({
  agreementCode,
  definition,
}) => {
  const { error } = validateAgreementDefinition(definition);

  if (!error) {
    return;
  }

  throw new Error(
    `Invalid Agreement definition "${agreementCode}": ${formatValidationErrors(error.details)}`,
  );
};

export const assertValidAgreementDefinitions = (definitions) => {
  for (const [agreementCode, definition] of definitions) {
    assertValidAgreementDefinition({ agreementCode, definition });
  }
};
