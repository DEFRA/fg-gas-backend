import Boom from "@hapi/boom";
import {
  agreementCommandRoutes,
  agreementImplementations,
  getAgreementDefinition,
} from "./agreement-definition.js";

export const isConfigBackedAgreement = (creation) =>
  creation.implementation === agreementImplementations.CONFIG;

export const getAgreementCommandRoute = ({ agreementCode, commandName }) =>
  getAgreementDefinition(agreementCode).commands?.[commandName]?.route ??
  agreementCommandRoutes.LEGACY;

export const getAgreementInitialVersion = (agreementCode) => {
  const definition = getAgreementDefinition(agreementCode);

  return toInitialVersion(definition);
};

export const getAgreementCreation = (agreementCode) => {
  const definition = getAgreementDefinition(agreementCode);

  return {
    agreementCode: definition.agreementCode,
    agreementNumber: definition.agreementNumber,
    configVersion: definition.configVersion,
    implementation: definition.implementation,
    initialVersion: toInitialVersion(definition),
  };
};

export const getAgreementAction = ({ agreementCode, actionName }) => {
  const definition = getAgreementDefinition(agreementCode);
  const action = definition.lifecycle?.actions?.[actionName];

  if (action) {
    const steps = action.steps.map((step) =>
      resolveStep({
        action,
        endpoints: definition.endpoints ?? [],
        payment: definition.payment,
        step,
      }),
    );

    return {
      actionName,
      agreementCode: definition.agreementCode,
      fromStatus: action.fromStatus,
      processingSteps: steps,
      target: action.target,
      toStatus: action.toStatus,
    };
  }

  throw Boom.badRequest(
    `Agreement definition ${definition.agreementCode} has no action named "${actionName}"`,
  );
};

const toInitialVersion = (definition) => {
  if (!definition.lifecycle) {
    return undefined;
  }

  return {
    changedBy: definition.lifecycle.changedBy,
    changeType: definition.lifecycle.initialChangeType,
    fromStatus: definition.lifecycle.fromStatus,
    initialStatus: definition.lifecycle.initialStatus,
  };
};

const toStepObject = (step) =>
  typeof step === "string" ? { type: step } : step;

const getStepValue = ({ action, property, step }) =>
  step[property] ?? action[property];

const getStepPaymentClaim = ({ action, payment, step }) =>
  getStepValue({ action, property: "paymentClaim", step }) ?? payment.claim;

const getEndpointCode = (endpoint) =>
  typeof endpoint === "string" ? endpoint : endpoint?.code;

const getEndpointParams = (endpoint) =>
  typeof endpoint === "string" ? undefined : endpoint?.endpointParams;

const resolveEndpoint = ({ endpoints, step }) => {
  const endpointCode = getEndpointCode(step.endpoint);
  const endpoint = endpoints.find(
    (candidate) => candidate.code === endpointCode,
  );

  if (!endpoint) {
    return step.endpoint;
  }

  return {
    ...endpoint,
    endpointParams: getEndpointParams(step.endpoint),
  };
};

const resolveStep = ({ action, endpoints, payment = {}, step }) => {
  const stepObject = toStepObject(step);

  return {
    ...stepObject,
    changeType: getStepValue({
      action,
      property: "changeType",
      step: stepObject,
    }),
    changedBy: getStepValue({
      action,
      property: "changedBy",
      step: stepObject,
    }),
    endpoint: resolveEndpoint({ endpoints, step: stepObject }),
    fromStatus: getStepValue({
      action,
      property: "fromStatus",
      step: stepObject,
    }),
    paymentClaim: getStepPaymentClaim({
      action,
      payment,
      step: stepObject,
    }),
    toStatus: getStepValue({
      action,
      property: "toStatus",
      step: stepObject,
    }),
  };
};
