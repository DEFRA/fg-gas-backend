import Boom from "@hapi/boom";
import Joi from "joi";
import { callAgreementEndpoint } from "../../../../common/agreements/call-agreement-endpoint.js";
import { compileTransitionValueMappings } from "../compile-transition-value-mapping.js";
import { agreementProcessHandlers } from "./agreement-process-registries.js";
import {
  compileProcessDefinitions,
  findProcessHandler,
} from "./compile-process-definitions.js";
import { findProcessOutputDependencies } from "./find-process-output-dependencies.js";

const collectSequences = (definition) => [
  {
    location: "create",
    path: "create.processes",
    processes: definition.create.processes ?? [],
    produced: Object.keys(definition.create.values ?? {}),
  },
  ...Object.entries(definition.states).flatMap(([stateName, state]) => [
    {
      location: "page",
      path: `states.${stateName}.processes`,
      processes: state.processes ?? [],
    },
    ...Object.entries(state.on ?? {}).map(([transitionName, transition]) => ({
      location: "transition",
      path: `states.${stateName}.on.${transitionName}.processes`,
      processes: transition.processes ?? [],
    })),
  ]),
];

const requireProcessDefinition = (processKey, sequence, processDefinitions) => {
  const definition = Object.hasOwn(processDefinitions, processKey)
    ? processDefinitions[processKey]
    : undefined;

  if (!definition) {
    throw Boom.badImplementation(
      `Agreement Process reference "${sequence.path}" names "${processKey}", which is not defined`,
    );
  }

  return definition;
};

const assertProducedOutput = (dependency, processKey, processDefinitions) => {
  if (!dependency.outputName) {
    return;
  }

  const outputs = processDefinitions[dependency.processKey].output ?? {};

  if (!Object.hasOwn(outputs, dependency.outputName)) {
    throw Boom.badImplementation(
      `Agreement Process "${dependency.processKey}" does not produce output "${dependency.outputName}" required by "${processKey}"`,
    );
  }
};

const assertDependency = (
  dependency,
  processKey,
  sequence,
  seen,
  processDefinitions,
) => {
  if (!seen.has(dependency.processKey)) {
    throw Boom.badImplementation(
      `Agreement Process "${processKey}" depends on "${dependency.processKey}", which must occur earlier in "${sequence.path}"`,
    );
  }

  assertProducedOutput(dependency, processKey, processDefinitions);
};

const recordOutputs = (definition, sequence, produced) => {
  for (const outputName of Object.keys(definition.output ?? {})) {
    if (produced.has(outputName)) {
      throw Boom.badImplementation(
        `Agreement Process sequence "${sequence.path}" output "${outputName}" has competing producers`,
      );
    }

    produced.add(outputName);
  }
};

const assertHandlerLocation = (processKey, definition, sequence, handlers) => {
  if (definition.type !== "handler") {
    return;
  }

  if (
    !findProcessHandler(processKey, handlers).locations.includes(
      sequence.location,
    )
  ) {
    throw Boom.badImplementation(
      `Agreement Process handler "${processKey}" is not allowed at location "${sequence.location}"`,
    );
  }
};

const requiredCreationValues = ["actions", "items"];

const assertRequiredCreationValues = (sequence, produced) => {
  if (sequence.location !== "create") {
    return;
  }

  const missing = requiredCreationValues.find((field) => !produced.has(field));
  if (missing) {
    throw Boom.badImplementation(
      `Agreement Process sequence "${sequence.path}" has no producer for required Agreement value "${missing}"`,
    );
  }
};

const validateSequence = (sequence, processDefinitions, handlers) => {
  const seen = new Set();
  const produced = new Set(sequence.produced);

  for (const processKey of sequence.processes) {
    const definition = requireProcessDefinition(
      processKey,
      sequence,
      processDefinitions,
    );

    if (seen.has(processKey)) {
      throw Boom.badImplementation(
        `Agreement Process sequence "${sequence.path}" contains "${processKey}" more than once`,
      );
    }

    for (const dependency of findProcessOutputDependencies(definition)) {
      assertDependency(
        dependency,
        processKey,
        sequence,
        seen,
        processDefinitions,
      );
    }

    recordOutputs(definition, sequence, produced);
    assertHandlerLocation(processKey, definition, sequence, handlers);
    seen.add(processKey);
  }

  assertRequiredCreationValues(sequence, produced);
};

const validateSequences = (definition, processDefinitions, handlers) => {
  for (const sequence of collectSequences(definition)) {
    validateSequence(sequence, processDefinitions, handlers);
  }
};

const executionSchema = Joi.object({
  executedAt: Joi.string().isoDate().required(),
  executionId: Joi.string().optional(),
  correlationId: Joi.string().optional(),
  idempotencyKey: Joi.string().optional(),
  idempotency: Joi.object().unknown(true).optional(),
}).required();

const agreementSchema = Joi.object().unknown(true).required();
const contextSchemas = {
  create: Joi.object({
    application: Joi.object().unknown(true).required(),
    execution: executionSchema,
  }).required(),
  transition: Joi.object({
    transition: Joi.object({
      values: Joi.object().unknown(true).required(),
    }).required(),
    agreement: agreementSchema,
    execution: executionSchema,
  }).required(),
  page: Joi.object({
    agreement: agreementSchema,
    execution: executionSchema,
  }).required(),
};

const validateContext = (context, location) => {
  const result = contextSchemas[location].validate(context, {
    abortEarly: false,
    allowUnknown: false,
    convert: false,
  });

  if (result.error) {
    const paths = result.error.details
      .map(({ path }) => path.join(".") || "context")
      .join(", ");
    throw Boom.badImplementation(
      `Invalid Agreement Process ${location} context at: ${paths}`,
    );
  }

  return result.value;
};

const findTransition = (definition, location) =>
  definition.states[location.state]?.on?.[location.transition];

const resolveTransitionLocation = (definition, location) => {
  const transition = findTransition(definition, location);

  if (!transition) {
    throw Boom.badImplementation(
      `Agreement Process location references unknown transition "${location.state}.${location.transition}"`,
    );
  }

  return {
    executionLocation: "transition",
    processes: transition.processes ?? [],
    stateName: location.state,
    target: transition.target,
    transitionName: location.transition,
  };
};

const allowedPages = (definition, state) => {
  const stateDefinition = definition.states[state];

  if (!stateDefinition) {
    return new Set();
  }

  return new Set(
    [
      stateDefinition.page,
      ...Object.values(stateDefinition.on ?? {}).map(
        (transition) => transition.page,
      ),
      definition.pages.document ? "document" : undefined,
    ].filter(Boolean),
  );
};

const resolvePageLocation = (definition, location) => {
  if (!allowedPages(definition, location.state).has(location.page)) {
    throw Boom.forbidden(
      `Page "${location.page}" is not valid for agreement code "${definition.code}" in state "${location.state}"`,
    );
  }

  return {
    executionLocation: "page",
    processes: definition.states[location.state].processes ?? [],
    target: location.state,
  };
};

const locationResolvers = {
  create: (definition) => ({
    executionLocation: "create",
    processes: definition.create.processes ?? [],
    target: definition.create.target,
  }),
  transition: resolveTransitionLocation,
  page: resolvePageLocation,
};

const resolveLocation = (definition, location) => {
  const resolve = locationResolvers[location?.type];

  if (!resolve) {
    throw Boom.badImplementation(
      `Unknown Agreement Process location "${location?.type}"`,
    );
  }

  return resolve(definition, location);
};

const locationContext = {
  create: (context) => ({ application: structuredClone(context.application) }),
  transition: (context, location) => ({
    agreement: structuredClone(context.agreement),
    transition: {
      name: location.transitionName,
      values: structuredClone(context.transition.values),
    },
  }),
  page: (context) => ({ agreement: structuredClone(context.agreement) }),
};

const toProcessContext = (context, location, outputs, agreement) => ({
  ...locationContext[location.executionLocation](
    agreement === undefined ? context : { ...context, agreement },
    location,
  ),
  execution: {
    ...structuredClone(context.execution),
    location: location.executionLocation,
    target: location.target,
  },
  outputs: structuredClone(outputs),
});

const isTransitionHandler = (location, definition) =>
  location.executionLocation === "transition" && definition.type === "handler";

const resolveCandidate = async (
  location,
  context,
  outputs,
  resolveTransitionValues,
) => {
  const agreementValues = await resolveTransitionValues({
    state: location.stateName,
    transition: location.transitionName,
    agreement: context.agreement,
    outputs,
  });

  return {
    agreement: agreementValues
      ? { ...structuredClone(context.agreement), ...agreementValues }
      : context.agreement,
    agreementValues,
  };
};

const toSequenceResult = (outputs, commitOperations, agreementValues) => ({
  outputs,
  ...(agreementValues === undefined ? {} : { agreementValues }),
  commitOperations,
});

// Transition values resolve at most once per sequence: immediately before the
// first staged handler so it sees them, or after the last Process when the
// sequence stages none.
const resolveWhenPending = async (candidate, pending, resolve) =>
  candidate ?? (pending ? resolve() : undefined);

const recordProcessResult = (outputs, commitOperations, processKey, result) => {
  Object.defineProperty(outputs, processKey, {
    configurable: true,
    enumerable: true,
    value: result.output,
    writable: true,
  });
  commitOperations.push(...result.commitOperations);
};

const runSequence = async (
  location,
  executableMap,
  processDefinitions,
  context,
  resolveTransitionValues,
) => {
  const commitOperations = [];
  const outputs = {};
  const resolve = () =>
    resolveCandidate(location, context, outputs, resolveTransitionValues);
  let candidate;

  for (const processKey of location.processes) {
    candidate = await resolveWhenPending(
      candidate,
      isTransitionHandler(location, processDefinitions[processKey]),
      resolve,
    );
    const result = await executableMap[processKey](
      toProcessContext(context, location, outputs, candidate?.agreement),
    );
    recordProcessResult(outputs, commitOperations, processKey, result);
  }

  candidate = await resolveWhenPending(
    candidate,
    location.executionLocation === "transition",
    resolve,
  );

  return toSequenceResult(
    outputs,
    commitOperations,
    candidate?.agreementValues,
  );
};

const resolveDependencies = (dependencies) => ({
  callEndpoint: dependencies.callEndpoint ?? callAgreementEndpoint,
  handlers: dependencies.handlers ?? agreementProcessHandlers,
});

export const compileAgreementProcesses = (definition, dependencies = {}) => {
  const resolveTransitionValues = compileTransitionValueMappings(definition);
  const resolvedDependencies = resolveDependencies(dependencies);
  const processDefinitions = definition.processDefinitions ?? {};
  const executableMap = compileProcessDefinitions(
    processDefinitions,
    resolvedDependencies,
  );
  validateSequences(
    definition,
    processDefinitions,
    resolvedDependencies.handlers,
  );

  return async ({ location, context }) => {
    const resolvedLocation = resolveLocation(definition, location);
    const validatedContext = validateContext(
      context,
      resolvedLocation.executionLocation,
    );

    return runSequence(
      resolvedLocation,
      executableMap,
      processDefinitions,
      validatedContext,
      resolveTransitionValues,
    );
  };
};
