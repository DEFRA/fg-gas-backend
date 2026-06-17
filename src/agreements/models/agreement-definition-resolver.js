import Boom from "@hapi/boom";
import { getAgreementDefinition } from "./agreement-definition.js";

export const isConfigBackedAgreement = (creation) =>
  creation.source !== "legacy";

const getAgreementSource = (definition) => definition.source ?? "config";

export const getAgreementCommandRoute = ({ agreementCode }) =>
  getAgreementSource(getAgreementDefinition(agreementCode)) === "config"
    ? "internal"
    : "legacy";

export const getAgreementInitialStatus = (agreementCode) => {
  const definition = getAgreementDefinition(agreementCode);

  return getInitialStatus(definition);
};

export const getAgreementCreation = (agreementCode) => {
  const definition = getAgreementDefinition(agreementCode);

  return {
    agreementCode: definition.code,
    agreementNumberPrefix: definition.agreementNumberPrefix,
    configVersion: definition.configVersion,
    create: isConfigBackedDefinition(definition)
      ? resolveCreate(definition)
      : undefined,
    initialStatus: getInitialStatus(definition),
    source: getAgreementSource(definition),
  };
};

export const getAgreementAction = ({ agreementCode, actionName, status }) => {
  const definition = getAgreementDefinition(agreementCode);
  const transitionMatch = findTransition({
    actionName,
    definition,
    status,
  });

  if (transitionMatch) {
    return toAgreementAction({
      actionName,
      definition,
      ...transitionMatch,
    });
  }

  throw Boom.badRequest(
    `Agreement definition ${definition.code} has no event named "${actionName}" for state "${status}"`,
  );
};

const isConfigBackedDefinition = (definition) =>
  getAgreementSource(definition) === "config";

const getInitialStatus = (definition) => definition.create?.target;

const getState = ({ definition, status }) => definition.states?.[status];

const getStateTransition = ({ actionName, state }) => state?.on?.[actionName];

const toTransitionMatch = ({ status, transition }) => ({ status, transition });

const findTransitionForState = ({ actionName, definition, status }) => {
  const transition = getStateTransition({
    actionName,
    state: getState({ definition, status }),
  });

  if (!transition) {
    return undefined;
  }

  return toTransitionMatch({ status, transition });
};

const findTransitionInAnyState = ({ actionName, definition }) =>
  Object.keys(definition.states ?? {})
    .map((candidateStatus) =>
      findTransitionForState({
        actionName,
        definition,
        status: candidateStatus,
      }),
    )
    .find(Boolean);

const findTransition = ({ actionName, definition, status }) =>
  findTransitionForState({ actionName, definition, status }) ??
  findTransitionInAnyState({ actionName, definition });

const getEndpointCode = (endpoint) =>
  typeof endpoint === "string" ? endpoint : endpoint?.code;

const getEndpointParams = (endpoint) =>
  typeof endpoint === "string" ? undefined : endpoint?.endpointParams;

const resolveEndpoint = ({ endpoints, endpoint }) => {
  const endpointCode = getEndpointCode(endpoint);
  const configuredEndpoint = endpoints.find(
    (candidate) => candidate.code === endpointCode,
  );

  if (!configuredEndpoint) {
    return endpoint;
  }

  return {
    ...configuredEndpoint,
    endpointParams: getEndpointParams(endpoint),
  };
};

const resolveCreateEffect = ({ definition, effect }) => {
  if (effect.name !== "callEndpoint") {
    return effect;
  }

  return resolveCallEndpointEffect({ definition, effect });
};

const resolveCreate = (definition) => ({
  effects: (definition.create?.effects ?? []).map((effect) =>
    resolveCreateEffect({ definition, effect }),
  ),
  target: definition.create?.target,
});

const resolveCallEndpointEffect = ({ definition, effect }) => ({
  ...effect,
  params: {
    ...effect.params,
    endpoint: resolveEndpoint({
      endpoints: definition.endpoints ?? [],
      endpoint: effect.params?.endpoint,
    }),
  },
});

const resolveEffect = ({ definition, effect, status, transition }) => {
  if (effect.name === "callEndpoint") {
    return resolveCallEndpointEffect({ definition, effect });
  }

  if (effect.name === "snapshot") {
    return {
      ...effect,
      fromStatus: status,
      target: transition.target,
    };
  }

  return effect;
};

const toAgreementAction = ({ actionName, definition, status, transition }) => ({
  actionName,
  agreementCode: definition.code,
  fromStatus: status,
  effects: transition.effects.map((effect) =>
    resolveEffect({
      definition,
      effect,
      status,
      transition,
    }),
  ),
  target: "agreementItem",
  toStatus: transition.target,
  validation: transition.validation,
});
