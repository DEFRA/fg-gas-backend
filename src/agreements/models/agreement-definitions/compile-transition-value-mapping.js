import Boom from "@hapi/boom";
import { isDeepStrictEqual } from "node:util";
import {
  resolveProcessMapping,
  validateProcessMapping,
} from "../../../common/resolve-process-mapping.js";
import { transitionAgreementValueCandidateSchema } from "../../schemas/agreement-value-candidate.schema.js";
import { agreementValueSchema } from "../../schemas/agreement-value.schema.js";
import { reconcileTransitionIdentities } from "../materialise-agreement-identities.js";
import { formatValidationErrorPaths } from "./format-validation-error-paths.js";
import { findProcessOutputDependencies } from "./processes/find-process-output-dependencies.js";
import { findUnknownMappingField } from "./processes/find-unknown-mapping-field.js";

const immutableValueFields = ["schemeCode", "name", "applicant", "application"];

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
    transitionAgreementValueCandidateSchema.describe(),
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

const assertDependencyOutput = (definition, entry, dependency) => {
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

// A staged handler reads the resolved transition values, so every Process the
// mapping depends on must run before the first one in the sequence.
const assertProducerBeforeHandlers = (entry, processKey, firstHandlerIndex) => {
  const producerIndex = entry.processes.indexOf(processKey);

  if (producerIndex === -1) {
    throw Boom.badImplementation(
      `Agreement transition values "${entry.path}" require Process "${processKey}" in the transition sequence`,
    );
  }

  if (firstHandlerIndex !== -1 && producerIndex >= firstHandlerIndex) {
    throw Boom.badImplementation(
      `Agreement transition values require "${processKey}" before staged handler "${entry.processes[firstHandlerIndex]}"`,
    );
  }
};

const assertDependenciesBeforeHandlers = (definition, entry, mapping) => {
  if (!mapping) {
    return;
  }

  const firstHandlerIndex = entry.processes.findIndex(
    (processKey) =>
      findProcessDefinition(definition, processKey)?.type === "handler",
  );

  for (const dependency of findProcessOutputDependencies({ input: mapping })) {
    assertDependencyOutput(definition, entry, dependency);
    assertProducerBeforeHandlers(
      entry,
      dependency.processKey,
      firstHandlerIndex,
    );
  }
};

const validateWith = (definition, schema, candidate) => {
  const result = schema.validate(candidate, {
    abortEarly: false,
    allowUnknown: false,
    convert: false,
  });

  if (result.error) {
    throw Boom.badImplementation(
      `Agreement definition "${definition.code}" produced invalid transition values at: ${formatValidationErrorPaths(result.error)}`,
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

const resolveMapping = async (definition, mapping, { agreement, outputs }) => {
  try {
    const mapped = await resolveProcessMapping(mapping, {
      agreement: structuredClone(agreement),
      outputs: structuredClone(outputs),
    });
    const candidate = validateWith(
      definition,
      transitionAgreementValueCandidateSchema,
      mapped,
    );
    assertImmutableValues(agreement, candidate);

    return validateWith(
      definition,
      agreementValueSchema,
      reconcileTransitionIdentities(agreement, candidate),
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
      const stateMappings = mappings.get(entry.stateName) ?? new Map();
      stateMappings.set(entry.transitionName, mapping);
      mappings.set(entry.stateName, stateMappings);
    }
  }

  return ({ state, transition, ...context }) => {
    const mapping = mappings.get(state)?.get(transition);

    return mapping ? resolveMapping(definition, mapping, context) : undefined;
  };
};
