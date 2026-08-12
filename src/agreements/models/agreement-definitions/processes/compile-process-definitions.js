import Boom from "@hapi/boom";
import {
  resolveProcessMapping,
  validateProcessMapping,
} from "../../../../common/agreements/resolve-process-mapping.js";
import { findAgreementProcessOutputSchema } from "../../../schemas/agreement-value-candidate.schema.js";
import { findProcessOutputDependencies } from "./find-process-output-dependencies.js";
import { findUnknownMappingField } from "./find-unknown-mapping-field.js";
import { validateMappedValue } from "./validate-mapped-value.js";

const badGatewayStatusCode = 502;

const assertValidMapping = (processKey, path, mapping) => {
  try {
    validateProcessMapping(mapping);
  } catch {
    throw Boom.badImplementation(
      `Agreement Process "${processKey}" ${path} has an invalid mapping`,
    );
  }
};

const assertKnownMappingFields = (mapping, schema, path) => {
  const unknownPath = findUnknownMappingField(mapping, schema, path);

  if (unknownPath) {
    throw Boom.badImplementation(
      `Agreement Process mapping field "${unknownPath}" is unknown`,
    );
  }
};

const assertKnownOutputMappings = (processKey, output) => {
  for (const [name, mapping] of Object.entries(output)) {
    const schema = findAgreementProcessOutputSchema(name);

    if (!schema) {
      throw Boom.badImplementation(
        `Agreement Process "${processKey}" declares unknown output "${name}"`,
      );
    }

    assertKnownMappingFields(
      mapping,
      schema.describe(),
      `${processKey}.output.${name}`,
    );
  }
};

const mapRequest = async (processKey, mapping, context) => {
  try {
    return await resolveProcessMapping(mapping, context);
  } catch {
    throw Boom.badImplementation(
      `Agreement Process "${processKey}" request mapping failed`,
    );
  }
};

const callEndpoint = async (processKey, call, endpoint, body) => {
  try {
    return await call(endpoint, { BODY: body });
  } catch (error) {
    if (
      Boom.isBoom(error) &&
      error.output.statusCode === badGatewayStatusCode
    ) {
      throw error;
    }

    throw Boom.badGateway(
      `Agreement Process "${processKey}" endpoint call failed`,
    );
  }
};

const mapOutput = async (processKey, output, context, response) => {
  try {
    const entries = await Promise.all(
      Object.entries(output).map(async ([name, mapping]) => {
        const mapped = await resolveProcessMapping(mapping, {
          ...context,
          response: structuredClone(response),
        });
        const schema = findAgreementProcessOutputSchema(name);
        const value = validateMappedValue(
          schema,
          mapped,
          `Agreement Process "${processKey}" returned malformed output "${name}"`,
        );

        return [name, value];
      }),
    );

    return Object.fromEntries(entries);
  } catch (error) {
    if (Boom.isBoom(error)) {
      throw Boom.badGateway(error.message);
    }

    throw Boom.badGateway(
      `Agreement Process "${processKey}" received a malformed response`,
    );
  }
};

const compileEndpoint = (processKey, definition, endpointCaller) => {
  assertValidMapping(processKey, "request.body", definition.request.body);
  assertValidMapping(processKey, "output", definition.output);
  assertKnownOutputMappings(processKey, definition.output);
  const endpoint = { code: processKey, ...definition.endpoint };

  return async (context) => {
    const body = await mapRequest(processKey, definition.request.body, context);
    const response = await callEndpoint(
      processKey,
      endpointCaller,
      endpoint,
      body,
    );

    return {
      commitOperations: [],
      output: await mapOutput(processKey, definition.output, context, response),
    };
  };
};

export const findProcessHandler = (processKey, handlers) => {
  const handler = Object.hasOwn(handlers, processKey)
    ? handlers[processKey]
    : undefined;

  if (!handler) {
    throw Boom.badImplementation(
      `Agreement Process handler "${processKey}" has no registered handler`,
    );
  }

  return handler;
};

const mapHandlerInput = async (processKey, definition, context) => {
  try {
    return await resolveProcessMapping(definition.input, context);
  } catch {
    throw Boom.badImplementation(
      `Agreement Process "${processKey}" input mapping failed`,
    );
  }
};

const validateHandlerResult = (processKey, handler, result) => {
  if (result === undefined) {
    return { commitOperations: [] };
  }

  if (!handler.commitOperationsSchema) {
    throw Boom.badImplementation(
      `Agreement Process handler "${processKey}" returned unsupported commit operations`,
    );
  }

  return validateMappedValue(
    handler.commitOperationsSchema,
    result,
    `Agreement Process handler "${processKey}" returned malformed commit operations`,
  );
};

const executeHandler = async (processKey, handler, context, input) => {
  try {
    const result = await handler.execute({
      agreement: structuredClone(context.agreement),
      execution: structuredClone(context.execution),
      input,
    });

    return validateHandlerResult(processKey, handler, result);
  } catch (error) {
    if (Boom.isBoom(error)) {
      throw error;
    }

    throw Boom.badImplementation(
      `Agreement Process handler "${processKey}" failed during execution`,
    );
  }
};

const compileHandler = (processKey, definition, handlers) => {
  const handler = findProcessHandler(processKey, handlers);
  assertValidMapping(processKey, "input", definition.input);
  assertKnownMappingFields(
    definition.input,
    handler.inputSchema.describe(),
    `${processKey}.input`,
  );

  return async (context) => {
    const mapped = await mapHandlerInput(processKey, definition, context);
    const input = validateMappedValue(
      handler.inputSchema,
      mapped,
      `Agreement Process "${processKey}" input failed validation`,
    );
    const { commitOperations } = await executeHandler(
      processKey,
      handler,
      context,
      input,
    );

    return { commitOperations, output: {} };
  };
};

const compileProcess = (processKey, definition, dependencies) => {
  const executable =
    definition.type === "endpoint"
      ? compileEndpoint(processKey, definition, dependencies.callEndpoint)
      : compileHandler(processKey, definition, dependencies.handlers);

  try {
    findProcessOutputDependencies(definition);
  } catch (error) {
    throw Boom.badImplementation(
      `Agreement Process "${processKey}" has an invalid output dependency: ${error.message}`,
    );
  }

  return executable;
};

export const compileProcessDefinitions = (definitions, dependencies) => {
  const executableMap = Object.create(null);

  for (const [key, definition] of Object.entries(definitions)) {
    executableMap[key] = compileProcess(key, definition, dependencies);
  }

  return executableMap;
};
