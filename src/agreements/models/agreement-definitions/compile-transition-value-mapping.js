import Boom from "@hapi/boom";
import Joi from "joi";
import { isDeepStrictEqual } from "node:util";
import {
  resolveProcessMapping,
  validateProcessMapping,
} from "../../../common/agreements/resolve-process-mapping.js";
import {
  agreementDateSchema,
  agreementValueSchema,
  applicantSchema,
  capitalItemSchema,
  parcelSchema,
  penceSchema,
  revenueActionSchema,
} from "../../schemas/agreement-value.schema.js";
import { findProcessOutputDependencies } from "./processes/find-process-output-dependencies.js";
import { findUnknownMappingField } from "./processes/find-unknown-mapping-field.js";

const immutableValueFields = ["schemeCode", "name", "applicant", "application"];

const transitionCandidateEntrySchema = (schema) =>
  schema
    .fork("id", (idSchema) => idSchema.optional())
    .append({ ref: Joi.string().optional() });

const transitionLineItemSchema = Joi.object({
  actionId: Joi.string().optional(),
  itemId: Joi.string().optional(),
  actionRef: Joi.string().optional(),
  itemRef: Joi.string().optional(),
  amountPence: penceSchema.required(),
}).xor("actionId", "itemId", "actionRef", "itemRef");

const transitionInstalmentSchema = Joi.object({
  id: Joi.string().optional(),
  dueDate: agreementDateSchema.required(),
  totalAmountPence: penceSchema.required(),
  lineItems: Joi.array().items(transitionLineItemSchema).required(),
});

const transitionPaymentScheduleSchema = Joi.object({
  frequency: Joi.string().optional(),
  instalments: Joi.array().items(transitionInstalmentSchema).required(),
});

const transitionCandidateSchema = Joi.object({
  schemeCode: Joi.string().optional(),
  name: Joi.string().optional(),
  applicant: applicantSchema.optional(),
  application: Joi.object().unknown(true).required(),
  startDate: agreementDateSchema.optional(),
  endDate: agreementDateSchema.optional(),
  parcels: Joi.array().items(parcelSchema).optional(),
  actions: Joi.array()
    .items(transitionCandidateEntrySchema(revenueActionSchema))
    .required(),
  items: Joi.array()
    .items(transitionCandidateEntrySchema(capitalItemSchema))
    .required(),
  annualAmountPence: penceSchema.optional(),
  totalAmountPence: penceSchema.optional(),
  paymentSchedule: transitionPaymentScheduleSchema.optional(),
});

const transitionEntries = (definition) =>
  Object.entries(definition.states).flatMap(([stateName, state]) =>
    Object.entries(state.on ?? {}).map(([transitionName, transition]) => ({
      path: `states.${stateName}.on.${transitionName}.values`,
      processes: transition.processes ?? [],
      stateName,
      transition,
      transitionName,
    })),
  );

const compileMapping = (definition, entry) => {
  if (entry.transition.values === undefined) {
    return undefined;
  }

  try {
    validateProcessMapping(entry.transition.values);
  } catch {
    throw Boom.badImplementation(
      `Invalid agreement definition "${definition.code}": "${entry.path}" contains an invalid mapping`,
    );
  }

  const unknownPath = findUnknownMappingField(
    entry.transition.values,
    transitionCandidateSchema.describe(),
    entry.path,
  );
  if (unknownPath) {
    throw Boom.badImplementation(
      `Invalid agreement definition "${definition.code}": "${unknownPath}" is unknown`,
    );
  }

  return structuredClone(entry.transition.values);
};

const findProcessDefinition = (definition, processKey) =>
  definition.processDefinitions?.[processKey];

const hasDeclaredOutput = (processDefinition, outputName) =>
  !outputName || Object.hasOwn(processDefinition.output ?? {}, outputName);

const assertDependencyOutput = (definition, dependency, entry) => {
  const processDefinition = findProcessDefinition(
    definition,
    dependency.processKey,
  );

  if (!processDefinition) {
    throw Boom.badImplementation(
      `Agreement transition values "${entry.path}" depend on undefined Process "${dependency.processKey}"`,
    );
  }

  if (!hasDeclaredOutput(processDefinition, dependency.outputName)) {
    throw Boom.badImplementation(
      `Agreement transition values "${entry.path}" depend on missing output "${dependency.processKey}.${dependency.outputName}"`,
    );
  }
};

const findFirstHandlerIndex = (definition, processes) =>
  processes.findIndex(
    (processKey) =>
      findProcessDefinition(definition, processKey)?.type === "handler",
  );

const requireProducerIndex = (entry, processKey) => {
  const producerIndex = entry.processes.indexOf(processKey);

  if (producerIndex === -1) {
    throw Boom.badImplementation(
      `Agreement transition values "${entry.path}" require Process "${processKey}" in the transition sequence`,
    );
  }

  return producerIndex;
};

const assertDependencyBeforeHandler = (
  entry,
  dependency,
  producerIndex,
  firstHandlerIndex,
) => {
  if (firstHandlerIndex === -1 || producerIndex < firstHandlerIndex) {
    return;
  }

  const handler = entry.processes[firstHandlerIndex];
  throw Boom.badImplementation(
    `Agreement transition values require "${dependency.processKey}" before staged handler "${handler}"`,
  );
};

const assertDependenciesBeforeHandlers = (definition, entry, mapping) => {
  if (!mapping) {
    return;
  }

  const firstHandlerIndex = findFirstHandlerIndex(definition, entry.processes);

  for (const dependency of findProcessOutputDependencies({ input: mapping })) {
    assertDependencyOutput(definition, dependency, entry);
    const producerIndex = requireProducerIndex(entry, dependency.processKey);
    assertDependencyBeforeHandler(
      entry,
      dependency,
      producerIndex,
      firstHandlerIndex,
    );
  }
};

const validationPaths = (error) =>
  error.details.map(({ path }) => path.join(".") || "value").join(", ");

const validateWith = (definition, schema, candidate) => {
  const result = schema.validate(candidate, {
    abortEarly: false,
    allowUnknown: false,
    convert: false,
  });

  if (result.error) {
    throw Boom.badImplementation(
      `Agreement definition "${definition.code}" produced invalid transition values at: ${validationPaths(result.error)}`,
    );
  }

  return structuredClone(result.value);
};

const assertImmutableValues = (agreement, candidate) => {
  for (const field of immutableValueFields) {
    if (!isDeepStrictEqual(candidate[field], agreement[field])) {
      throw Boom.badImplementation(
        `Agreement transition cannot change immutable Agreement field "${field}"`,
      );
    }
  }
};

const identityOrdinal = (id, namespace) => {
  const match = id.match(new RegExp(`^${namespace}:([1-9]\\d*)$`));
  return match ? Number(match[1]) : 0;
};

const nextIdentityOrdinal = (entries, namespace) =>
  Math.max(0, ...entries.map(({ id }) => identityOrdinal(id, namespace))) + 1;

const requireExistingIdentity = (id, existingIds, label) => {
  if (!existingIds.has(id)) {
    throw Boom.badImplementation(
      `Agreement transition cannot select unknown stable ${label} identity "${id}"`,
    );
  }

  return id;
};

const resolveEntryIdentity = (candidate, allocation) => {
  if (candidate.id) {
    return requireExistingIdentity(
      candidate.id,
      allocation.existingIds,
      allocation.label,
    );
  }

  const id = `${allocation.namespace}:${allocation.nextOrdinal}`;
  allocation.nextOrdinal += 1;
  return id;
};

const recordCandidateReference = (candidate, id, references) => {
  if (candidate.ref === undefined) {
    return;
  }

  if (references.has(candidate.ref)) {
    throw Boom.badImplementation(
      `Agreement transition produced duplicate candidate reference "${candidate.ref}"`,
    );
  }

  references.set(candidate.ref, id);
};

const reconcileEntries = (currentEntries, candidates, namespace, label) => {
  const allocation = {
    existingIds: new Set(currentEntries.map(({ id }) => id)),
    label,
    namespace,
    nextOrdinal: nextIdentityOrdinal(currentEntries, namespace),
  };
  const references = new Map();
  const values = candidates.map((candidate) => {
    const id = resolveEntryIdentity(candidate, allocation);
    recordCandidateReference(candidate, id, references);
    const value = structuredClone(candidate);
    delete value.ref;

    return { ...value, id };
  });

  return { references, values };
};

const candidateReferenceFields = [
  { candidateField: "actionRef", persistedField: "actionId", type: "actions" },
  { candidateField: "itemRef", persistedField: "itemId", type: "items" },
];

const findCandidateReference = (lineItem) =>
  candidateReferenceFields.find(({ candidateField }) =>
    Object.hasOwn(lineItem, candidateField),
  );

const resolveCandidateLineItem = (lineItem, reconciled) => {
  const reference = findCandidateReference(lineItem);

  if (!reference) {
    return structuredClone(lineItem);
  }

  const id = reconciled[reference.type].references.get(
    lineItem[reference.candidateField],
  );
  if (!id) {
    throw Boom.badImplementation(
      `Agreement transition produced unknown candidate reference "${lineItem[reference.candidateField]}"`,
    );
  }

  return {
    [reference.persistedField]: id,
    amountPence: lineItem.amountPence,
  };
};

const reconcileInstalment = (instalment, allocation, reconciled) => {
  const id = resolveEntryIdentity(instalment, allocation);

  return {
    ...instalment,
    id,
    lineItems: instalment.lineItems.map((lineItem) =>
      resolveCandidateLineItem(lineItem, reconciled),
    ),
  };
};

const reconcilePaymentSchedule = (current, candidate, reconciled) => {
  if (!candidate) {
    return undefined;
  }

  const currentInstalments = current?.instalments ?? [];
  const allocation = {
    existingIds: new Set(currentInstalments.map(({ id }) => id)),
    label: "Payment Schedule Instalment",
    namespace: "instalment",
    nextOrdinal: nextIdentityOrdinal(currentInstalments, "instalment"),
  };

  return {
    ...candidate,
    instalments: candidate.instalments.map((instalment) =>
      reconcileInstalment(instalment, allocation, reconciled),
    ),
  };
};

const reconcileCandidateIdentities = (agreement, candidate) => {
  const reconciled = {
    actions: reconcileEntries(
      agreement.actions,
      candidate.actions,
      "action",
      "Revenue Action",
    ),
    items: reconcileEntries(
      agreement.items,
      candidate.items,
      "item",
      "Capital Item",
    ),
  };

  return {
    ...candidate,
    actions: reconciled.actions.values,
    items: reconciled.items.values,
    paymentSchedule: reconcilePaymentSchedule(
      agreement.paymentSchedule,
      candidate.paymentSchedule,
      reconciled,
    ),
  };
};

const resolveMapping = async (definition, mapping, { agreement, outputs }) => {
  try {
    const mapped = await resolveProcessMapping(mapping, {
      agreement: structuredClone(agreement),
      outputs: structuredClone(outputs),
    });
    const candidate = validateWith(
      definition,
      transitionCandidateSchema,
      mapped,
    );
    assertImmutableValues(agreement, candidate);

    return validateWith(
      definition,
      agreementValueSchema,
      reconcileCandidateIdentities(agreement, candidate),
    );
  } catch (error) {
    if (Boom.isBoom(error)) {
      throw error;
    }

    throw Boom.badImplementation(
      `Agreement definition "${definition.code}" could not resolve transition values`,
    );
  }
};

export const compileTransitionValueMappings = (definition) => {
  const mappings = new Map();

  for (const entry of transitionEntries(definition)) {
    const mapping = compileMapping(definition, entry);
    assertDependenciesBeforeHandlers(definition, entry, mapping);

    if (mapping) {
      mappings.set(`${entry.stateName}\u0000${entry.transitionName}`, mapping);
    }
  }

  return ({ state, transition, ...context }) => {
    const mapping = mappings.get(`${state}\u0000${transition}`);

    return mapping ? resolveMapping(definition, mapping, context) : undefined;
  };
};
