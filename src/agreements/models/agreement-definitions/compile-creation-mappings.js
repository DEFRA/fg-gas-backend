import Boom from "@hapi/boom";
import {
  resolveProcessMapping,
  validateProcessMapping,
} from "../../../common/agreements/resolve-process-mapping.js";
import { findAgreementProcessOutputSchema } from "../../schemas/agreement-value-candidate.schema.js";
import { findUnknownMappingField } from "./processes/find-unknown-mapping-field.js";
import { validateMappedValue } from "./processes/validate-mapped-value.js";

const compileMapping = (definition, mapping, path) => {
  try {
    validateProcessMapping(mapping);
    return structuredClone(mapping);
  } catch {
    throw Boom.badImplementation(
      `Invalid agreement definition "${definition.code}": "${path}" contains an invalid mapping`,
    );
  }
};

const resolveMapping = async ({
  allowUnresolved = false,
  context,
  mapping,
  resolutionError,
}) => {
  try {
    return await resolveProcessMapping(mapping, context, { allowUnresolved });
  } catch {
    throw resolutionError();
  }
};

const invalidApplication = (definition) =>
  Boom.badImplementation(
    `Agreement definition "${definition.code}" resolved an invalid Application`,
  );

const isApplication = (value) =>
  value !== null && !Array.isArray(value) && typeof value === "object";

const resolveApplication = async (definition, mapping, input) => {
  const application = await resolveMapping({
    context: { input: structuredClone(input) },
    mapping,
    resolutionError: () =>
      Boom.badImplementation(
        `Agreement definition "${definition.code}" could not resolve Application`,
      ),
  });

  if (!isApplication(application)) {
    throw invalidApplication(definition);
  }

  try {
    return structuredClone(application);
  } catch {
    throw invalidApplication(definition);
  }
};

const assertKnownCreationValueFields = (definition, mapping) => {
  for (const [field, fieldMapping] of Object.entries(mapping)) {
    const schema = findAgreementProcessOutputSchema(field);
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

const requiredCreationValues = new Set(["actions", "items"]);

const creationValueSchema = (field) => {
  const schema = findAgreementProcessOutputSchema(field);

  return requiredCreationValues.has(field) ? schema.required() : schema;
};

const validateCreationValue = (definition, field, value) =>
  validateMappedValue(
    creationValueSchema(field),
    value,
    `Agreement definition "${definition.code}" produced invalid creation value "${field}"`,
  );

const resolveCreationValues = async (
  definition,
  mapping,
  input,
  application,
) => {
  const context = {
    input: structuredClone(input),
    application: structuredClone(application),
  };
  const entries = await Promise.all(
    Object.entries(mapping).map(async ([field, fieldMapping]) => {
      const value = await resolveMapping({
        allowUnresolved: true,
        context,
        mapping: fieldMapping,
        resolutionError: () =>
          Boom.badImplementation(
            `Agreement definition "${definition.code}" could not resolve creation values`,
          ),
      });

      return [field, validateCreationValue(definition, field, value)];
    }),
  );

  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
};

export const compileCreationMappings = (definition) => {
  const applicationMapping = compileMapping(
    definition,
    definition.create.application,
    "create.application",
  );
  const creationValueMapping = compileMapping(
    definition,
    definition.create.values ?? {},
    "create.values",
  );
  assertKnownCreationValueFields(definition, creationValueMapping);

  return async (input) => {
    const application = await resolveApplication(
      definition,
      applicationMapping,
      input,
    );
    const mappedValues = await resolveCreationValues(
      definition,
      creationValueMapping,
      input,
      application,
    );

    return { application, mappedValues };
  };
};
