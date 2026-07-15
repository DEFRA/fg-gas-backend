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

const resolvePageFromDefinition = (definition, { code, page }) => {
  const pageDefinition = definition.pages[page];

  if (!pageDefinition) {
    throw Boom.notFound(`Unknown page "${page}" for agreement code "${code}"`);
  }

  return structuredClone(pageDefinition);
};

export const resolveAgreementPage = (code, page) =>
  resolvePageFromDefinition(loadValidatedDefinition(code), { code, page });

const assertAgreementDefinitionVersion = (
  definition,
  { code, configVersion },
) => {
  if (definition.configVersion !== configVersion) {
    throw Boom.badImplementation(
      `Agreement definition "${code}" is version "${definition.configVersion}" but the Agreement uses version "${configVersion}"`,
    );
  }
};

export const resolveAgreementPageForVersion = ({
  code,
  page,
  configVersion,
}) => {
  const definition = loadValidatedDefinition(code);
  assertAgreementDefinitionVersion(definition, { code, configVersion });

  return resolvePageFromDefinition(definition, { code, page });
};

export const resolveAgreementPageForStatus = ({ code, status }) => {
  const definition = loadValidatedDefinition(code);
  const stateDefinition = definition.states[status];

  if (!stateDefinition) {
    throw Boom.badImplementation(
      `Agreement code "${code}" has unknown persisted state "${status}"`,
    );
  }

  const pageId = stateDefinition.page;
  const pageDefinition = definition.pages[pageId];

  if (!pageId || !pageDefinition) {
    throw Boom.badImplementation(
      `Agreement code "${code}" state "${status}" has no configured page`,
    );
  }

  return { pageId };
};

const collectAllowedPages = (stateDefinition) =>
  new Set(
    [
      stateDefinition.page,
      ...Object.values(stateDefinition.on ?? {}).map(
        (action) => action.validation?.page,
      ),
    ].filter(Boolean),
  );

export const assertAgreementPageAllowedForStatus = (code, page, status) => {
  const definition = loadValidatedDefinition(code);

  const stateDefinition = definition.states[status];

  if (!stateDefinition) {
    throw Boom.notFound(
      `Unknown state "${status}" for agreement code "${code}"`,
    );
  }

  if (!collectAllowedPages(stateDefinition).has(page)) {
    throw Boom.forbidden(
      `Page "${page}" is not valid for agreement code "${code}" in state "${status}"`,
    );
  }
};

const SUPPORTED_RENDER_MODES = new Set(["view"]);

export const resolveAgreementPageMode = (mode) => {
  if (!SUPPORTED_RENDER_MODES.has(mode)) {
    throw Boom.notFound(`Unsupported mode "${mode}"`);
  }

  return mode;
};
