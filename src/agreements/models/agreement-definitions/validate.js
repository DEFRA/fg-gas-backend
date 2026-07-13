import Boom from "@hapi/boom";
import { agreementDefinitionSchema } from "../../schemas/agreement-definition.schema.js";

const findValidationReferenceErrors = (validation, path, pages) => {
  if (!validation || pages[validation.page]) {
    return [];
  }

  return [
    `"${path}.validation.page" ("${validation.page}") does not match any key in "pages"`,
  ];
};

const findActionReferenceErrors = (action, path, states, pages) => {
  const errors = [];

  if (!states[action.target]) {
    errors.push(
      `"${path}.target" ("${action.target}") does not match any key in "states"`,
    );
  }

  errors.push(...findValidationReferenceErrors(action.validation, path, pages));

  return errors;
};

const findStateReferenceErrors = (state, stateName, states, pages) => {
  const errors = [];
  const actions = state.on ?? {};

  for (const [actionName, action] of Object.entries(actions)) {
    errors.push(
      ...findActionReferenceErrors(
        action,
        `states.${stateName}.on.${actionName}`,
        states,
        pages,
      ),
    );
  }

  return errors;
};

const findReferenceErrors = ({ create, states, pages }) => {
  const errors = [];

  if (!states[create.target]) {
    errors.push(
      `"create.target" ("${create.target}") does not match any key in "states"`,
    );
  }

  for (const [stateName, state] of Object.entries(states)) {
    errors.push(...findStateReferenceErrors(state, stateName, states, pages));
  }

  return errors;
};

const runValidation = (definition) => {
  const { value, error } = agreementDefinitionSchema.validate(definition, {
    abortEarly: false,
  });

  if (error) {
    // badImplementation (500), not badRequest: an invalid Agreement definition
    // is a server-side configuration defect, never something a caller supplied.
    throw Boom.badImplementation(
      `Invalid agreement definition "${definition?.code}": ${error.details.map((d) => d.message).join(", ")}`,
    );
  }

  const referenceErrors = findReferenceErrors(value);

  if (referenceErrors.length > 0) {
    throw Boom.badImplementation(
      `Invalid agreement definition "${value.code}": ${referenceErrors.join(", ")}`,
    );
  }

  return value;
};

// Agreement definitions are static, in-memory objects, so a given definition
// only ever needs to be validated once per process: cache by reference to
// avoid re-running Joi + reference-integrity checks on every request.
const validatedDefinitions = new WeakMap();

export const validateAgreementDefinition = (definition) => {
  if (!validatedDefinitions.has(definition)) {
    validatedDefinitions.set(definition, runValidation(definition));
  }

  return validatedDefinitions.get(definition);
};
