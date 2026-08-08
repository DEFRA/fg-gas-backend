import Boom from "@hapi/boom";
import {
  resolveProcessMapping,
  validateProcessMapping,
} from "../../../common/agreements/resolve-process-mapping.js";
import { findProcessOutputSchema } from "./processes/agreement-process-registries.js";
import { findUnknownMappingField } from "./processes/find-unknown-mapping-field.js";

const assertKnownFields = (definition, mapping) => {
  for (const [field, fieldMapping] of Object.entries(mapping)) {
    const schema = findProcessOutputSchema(field);
    if (!schema) {
      throw Boom.badImplementation(
        `Invalid agreement definition "${definition.code}": "create.values.${field}" is not a supported Agreement value`,
      );
    }

    const unknownPath = findUnknownMappingField(
      fieldMapping,
      schema.describe(),
      `create.values.${field}`,
    );
    if (unknownPath) {
      throw Boom.badImplementation(
        `Invalid agreement definition "${definition.code}": "${unknownPath}" is unknown`,
      );
    }
  }
};

const compileMapping = (definition) => {
  const mapping = definition.create.values ?? {};

  try {
    validateProcessMapping(mapping);
  } catch {
    throw Boom.badImplementation(
      `Invalid agreement definition "${definition.code}": "create.values" contains an invalid mapping`,
    );
  }

  assertKnownFields(definition, mapping);
  return structuredClone(mapping);
};

const validationPaths = (error) =>
  error.details.map(({ path }) => path.join(".") || "value").join(", ");

const validateMappedValues = (definition, values) => {
  for (const [field, value] of Object.entries(values)) {
    const result = findProcessOutputSchema(field).validate(value, {
      abortEarly: false,
      allowUnknown: false,
      convert: false,
    });

    if (result.error) {
      throw Boom.badImplementation(
        `Agreement definition "${definition.code}" produced invalid creation value "${field}" at: ${validationPaths(result.error)}`,
      );
    }
  }

  return structuredClone(values);
};

const resolveValues = async (definition, mapping, context) => {
  try {
    const values = await resolveProcessMapping(mapping, {
      input: structuredClone(context.input),
      application: structuredClone(context.application),
    });

    return validateMappedValues(definition, values);
  } catch (error) {
    if (Boom.isBoom(error)) {
      throw error;
    }

    throw Boom.badImplementation(
      `Agreement definition "${definition.code}" could not resolve creation values`,
    );
  }
};

export const compileCreationValueMapping = (definition) => {
  const mapping = compileMapping(definition);

  return (context) => resolveValues(definition, mapping, context);
};
