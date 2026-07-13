import Boom from "@hapi/boom";
import { getAgreementDefinitionByCode } from "./index.js";
import { validateAgreementDefinition } from "./validate.js";

const loadValidatedDefinition = (code) => {
  const definition = getAgreementDefinitionByCode(code);

  if (!definition) {
    throw Boom.notFound(`Unknown agreement code: "${code}"`);
  }

  return validateAgreementDefinition(definition);
};

export const resolveAgreementCreation = (code) => {
  const definition = loadValidatedDefinition(code);

  return structuredClone({
    agreementNumberPrefix: definition.agreementNumberPrefix,
    ...definition.create,
  });
};

export const resolveAgreementAction = (code, state, action) => {
  const definition = loadValidatedDefinition(code);

  const stateDefinition = definition.states[state];

  if (!stateDefinition) {
    throw Boom.notFound(
      `Unknown state "${state}" for agreement code "${code}"`,
    );
  }

  const actionDefinition = stateDefinition.on?.[action];

  if (!actionDefinition) {
    throw Boom.notFound(
      `Unknown action "${action}" for state "${state}" on agreement code "${code}"`,
    );
  }

  return structuredClone(actionDefinition);
};

export const resolveAgreementPage = (code, page) => {
  const definition = loadValidatedDefinition(code);

  const pageDefinition = definition.pages[page];

  if (!pageDefinition) {
    throw Boom.notFound(`Unknown page "${page}" for agreement code "${code}"`);
  }

  return structuredClone(pageDefinition);
};

const SUPPORTED_RENDER_MODES = new Set(["view"]);

export const resolveAgreementPageMode = (mode) => {
  if (!SUPPORTED_RENDER_MODES.has(mode)) {
    throw Boom.notFound(`Unsupported mode "${mode}"`);
  }

  return mode;
};
