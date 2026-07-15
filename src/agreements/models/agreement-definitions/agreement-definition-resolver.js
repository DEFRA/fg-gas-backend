import Boom from "@hapi/boom";
import { AgreementLifecycle } from "../agreement-lifecycle.js";
import { getAgreementDefinitionByCodeAndVersion } from "./index.js";
import { validateAgreementDefinition } from "./validate.js";

const loadValidatedDefinitionForVersion = (code, configVersion) => {
  const definition = getAgreementDefinitionByCodeAndVersion(
    code,
    configVersion,
  );

  if (!definition) {
    throw Boom.badImplementation(
      `Agreement definition "${code}" version "${configVersion}" is unavailable`,
    );
  }

  return validateAgreementDefinition(definition);
};

const resolveActionFromDefinition = (definition, { code, state, action }) => {
  if (!Object.hasOwn(definition.states, state)) {
    throw Boom.notFound(
      `Unknown state "${state}" for agreement code "${code}"`,
    );
  }

  return new AgreementLifecycle(definition).resolveAction(state, action);
};

const resolvePageFromDefinition = (definition, { code, page }) => {
  const pageDefinition = definition.pages[page];

  if (!pageDefinition) {
    throw Boom.notFound(`Unknown page "${page}" for agreement code "${code}"`);
  }

  return structuredClone(pageDefinition);
};

const requirePersistedStateDefinition = (definition, { code, state }) => {
  if (!Object.hasOwn(definition.states, state)) {
    throw Boom.badImplementation(
      `Agreement code "${code}" has unknown persisted state "${state}"`,
    );
  }

  return definition.states[state];
};

export const resolveAgreementActionForVersion = ({
  code,
  state,
  action,
  configVersion,
}) => {
  const definition = loadValidatedDefinitionForVersion(code, configVersion);
  requirePersistedStateDefinition(definition, { code, state });

  return resolveActionFromDefinition(definition, { code, state, action });
};

export const resolveAgreementPageForVersion = ({
  code,
  page,
  configVersion,
}) => {
  const definition = loadValidatedDefinitionForVersion(code, configVersion);

  return resolvePageFromDefinition(definition, { code, page });
};

export const resolveAgreementPageForStatus = ({
  code,
  status,
  configVersion,
}) => {
  const definition = loadValidatedDefinitionForVersion(code, configVersion);
  const stateDefinition = requirePersistedStateDefinition(definition, {
    code,
    state: status,
  });

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

export const assertAgreementPageAllowedForStatus = ({
  code,
  page,
  status,
  configVersion,
}) => {
  const definition = loadValidatedDefinitionForVersion(code, configVersion);

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
