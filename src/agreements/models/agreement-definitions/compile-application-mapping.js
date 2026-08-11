import Boom from "@hapi/boom";
import {
  resolveProcessMapping,
  validateProcessMapping,
} from "../../../common/agreements/resolve-process-mapping.js";

const compileMapping = (definition) => {
  try {
    validateProcessMapping(definition.create.application);
    return structuredClone(definition.create.application);
  } catch {
    throw Boom.badImplementation(
      `Invalid agreement definition "${definition.code}": "create.application" contains an invalid mapping`,
    );
  }
};

const isApplication = (value) =>
  value !== null && !Array.isArray(value) && typeof value === "object";

const resolveMapping = async (definition, mapping, input) => {
  try {
    return await resolveProcessMapping(mapping, {
      input: structuredClone(input),
    });
  } catch {
    throw Boom.badImplementation(
      `Agreement definition "${definition.code}" could not resolve Application`,
    );
  }
};

const invalidApplication = (definition) =>
  Boom.badImplementation(
    `Agreement definition "${definition.code}" resolved an invalid Application`,
  );

const cloneApplication = (definition, application) => {
  try {
    return structuredClone(application);
  } catch {
    throw invalidApplication(definition);
  }
};

const resolveApplication = async (definition, mapping, input) => {
  const application = await resolveMapping(definition, mapping, input);

  if (!isApplication(application)) {
    throw invalidApplication(definition);
  }

  return cloneApplication(definition, application);
};

export const compileApplicationMapping = (definition) => {
  const mapping = compileMapping(definition);

  return (input) => resolveApplication(definition, mapping, input);
};
