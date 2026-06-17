import Joi from "joi";

const agreementSources = {
  CONFIG: "config",
  LEGACY: "legacy",
};

const effectNames = [
  "callEndpoint",
  "createPaymentClaim",
  "publish",
  "snapshot",
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

const selectOutputSchema = Joi.object({
  select: nonEmptyString.optional(),
}).unknown(false);

const stepOutputSchema = Joi.alternatives().try(
  selectOutputSchema,
  pathOutputSchema,
  targetOutputSchema,
);

const actionValidationRequiredFieldSchema = Joi.object({
  href: nonEmptyString.optional(),
  message: nonEmptyString.optional(),
  name: nonEmptyString.required(),
  value: Joi.alternatives()
    .try(Joi.string(), Joi.number(), Joi.boolean())
    .optional(),
}).unknown(false);

const transitionValidationSchema = Joi.object({
  page: nonEmptyString.optional(),
  required: Joi.array()
    .items(actionValidationRequiredFieldSchema)
    .min(1)
    .optional(),
}).unknown(false);

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

const renderPageSchema = Joi.object({
  actions: Joi.array().items(Joi.object().unknown(true)).optional(),
  components: Joi.array().items(Joi.object().unknown(true)).required(),
  layout: nonEmptyString.optional(),
  title: nonEmptyString.required(),
}).unknown(false);

const pagesSchema = Joi.object()
  .pattern(nonEmptyString, renderPageSchema)
  .min(1)
  .required();

const effectParamsSchema = Joi.object({
  endpoint: endpointReferenceSchema.optional(),
  event: Joi.string().valid("lifecycle").optional(),
  output: stepOutputSchema.optional(),
  fundingCalculation: Joi.any().optional(),
  mapping: Joi.object().unknown(true).optional(),
  payment: Joi.any().optional(),
  paymentClaim: paymentClaimSchema.optional(),
  schedule: Joi.object().unknown(true).optional(),
}).unknown(true);

const effectSchema = Joi.object({
  name: Joi.string()
    .valid(...effectNames)
    .required(),
  output: nonEmptyString.optional(),
  params: effectParamsSchema.optional(),
}).unknown(false);

const transitionSchema = Joi.object({
  effects: Joi.array().items(effectSchema).min(1).required(),
  target: nonEmptyString.required(),
  validation: transitionValidationSchema.optional(),
}).unknown(false);

const stateSchema = Joi.object({
  on: Joi.object().pattern(nonEmptyString, transitionSchema).optional(),
}).unknown(false);

const createSchema = Joi.object({
  effects: Joi.array().items(effectSchema).optional(),
  target: nonEmptyString.required(),
}).unknown(false);

const statesSchema = Joi.object()
  .pattern(nonEmptyString, stateSchema)
  .min(1)
  .required();

const getStateEntries = (definition) => Object.entries(definition.states ?? {});

const getTransitions = (definition) =>
  getStateEntries(definition).flatMap(([fromStatus, state]) =>
    Object.entries(state.on ?? {}).map(([eventName, transition]) => ({
      eventName,
      fromStatus,
      transition,
    })),
  );

const getTransitionEffects = (definition) =>
  getTransitions(definition).flatMap(({ transition }) => transition.effects);

const getCreateEffects = (definition) => definition.create.effects ?? [];

const getEffects = (definition) => [
  ...getCreateEffects(definition),
  ...getTransitionEffects(definition),
];

const hasPaymentClaim = ({ effect }) => Boolean(effect.params?.paymentClaim);

const hasMissingEffectConfig = ({ definition, effectNames, hasConfig }) =>
  getEffects(definition).some(
    (effect) =>
      effectNames.includes(effect.name) && !hasConfig({ definition, effect }),
  );

const hasMissingPaymentClaim = (definition) =>
  hasMissingEffectConfig({
    definition,
    effectNames: ["createPaymentClaim"],
    hasConfig: hasPaymentClaim,
  });

const getEffectEndpoint = (effect) => effect.params?.endpoint;

const getEndpointCode = (effect) => {
  const endpoint = getEffectEndpoint(effect);

  if (typeof endpoint === "string") {
    return endpoint;
  }

  return endpoint?.code;
};

const hasEndpoint = ({ definition, effect }) =>
  definition.endpoints?.some(
    (endpoint) => endpoint.code === getEndpointCode(effect),
  );

const hasMissingEndpoint = (definition) =>
  hasMissingEffectConfig({
    definition,
    effectNames: ["callEndpoint"],
    hasConfig: hasEndpoint,
  });

const hasMissingCreateTargetState = (definition) =>
  !definition.states[definition.create.target];

const hasMissingStatePage = (definition) =>
  Object.keys(definition.states).some((status) => !definition.pages[status]);

const hasMissingTargetState = (definition) =>
  getTransitions(definition).some(
    ({ transition }) => !definition.states[transition.target],
  );

const hasMissingSnapshotEffect = (definition) =>
  getTransitions(definition).some(
    ({ transition }) =>
      transition.effects.filter((effect) => effect.name === "snapshot")
        .length !== 1,
  );

const crossChecks = [
  [hasMissingCreateTargetState, "agreementDefinition.missingCreateTargetState"],
  [hasMissingTargetState, "agreementDefinition.missingTargetState"],
  [hasMissingSnapshotEffect, "agreementDefinition.missingSnapshotEffect"],
  [hasMissingEndpoint, "agreementDefinition.missingEndpoint"],
  [hasMissingPaymentClaim, "agreementDefinition.missingPaymentClaim"],
  [hasMissingStatePage, "agreementDefinition.missingStatePage"],
];

const getCrossCheckError = (definition) =>
  crossChecks.find(([check]) => check(definition))?.[1];

const validateAgreementDefinitionReferences = (definition, helpers) => {
  const error = getCrossCheckError(definition);

  if (error) {
    return helpers.error(error);
  }

  return definition;
};

const configAgreementDefinitionSchema = Joi.object({
  code: nonEmptyString.required(),
  agreementNumberPrefix: nonEmptyString.required(),
  configVersion: nonEmptyString.required(),
  create: createSchema.required(),
  endpoints: Joi.array().items(endpointSchema).unique("code").optional(),
  pages: pagesSchema,
  states: statesSchema,
})
  .custom(validateAgreementDefinitionReferences)
  .messages({
    "agreementDefinition.missingEndpoint":
      "callEndpoint effects require an endpoint matching params.endpoint.code",
    "agreementDefinition.missingCreateTargetState":
      "create target must match a configured state",
    "agreementDefinition.missingPaymentClaim":
      "createPaymentClaim effects require params.paymentClaim",
    "agreementDefinition.missingSnapshotEffect":
      "state transitions require exactly one snapshot effect",
    "agreementDefinition.missingStatePage":
      "states require a matching page with the same key",
    "agreementDefinition.missingTargetState":
      "transition targets must match a configured state",
  })
  .unknown(false);

const legacyAgreementDefinitionSchema = Joi.object({
  code: nonEmptyString.required(),
  source: Joi.string().valid(agreementSources.LEGACY).required(),
}).unknown(false);

export const agreementDefinitionSchema = Joi.alternatives().try(
  configAgreementDefinitionSchema,
  legacyAgreementDefinitionSchema,
);

const schemasBySource = {
  [agreementSources.CONFIG]: configAgreementDefinitionSchema,
  [agreementSources.LEGACY]: legacyAgreementDefinitionSchema,
};

export const validateAgreementDefinition = (definition) =>
  (
    schemasBySource[definition?.source] ?? configAgreementDefinitionSchema
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
