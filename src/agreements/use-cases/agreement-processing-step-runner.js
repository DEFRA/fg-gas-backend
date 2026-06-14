import Boom from "@hapi/boom";
import { createAgreementPaymentClaimStep } from "./create-agreement-payment-claim-step.use-case.js";
import { emitAgreementLifecycleEventStep } from "./emit-agreement-lifecycle-event-step.use-case.js";
import { invokeAgreementEndpointStep } from "./invoke-agreement-endpoint-step.use-case.js";
import { recordAgreementItemTransitionStep } from "./record-agreement-item-transition-step.use-case.js";

const stepTypes = {
  CALL_ENDPOINT: "callEndpoint",
  CREATE_PAYMENT_CLAIM: "createPaymentClaim",
  EMIT_LIFECYCLE_EVENT: "emitLifecycleEvent",
  RECORD_TRANSITION: "recordTransition",
};

const getStepType = (step) => (typeof step === "string" ? step : step.type);

const callEndpoint = async (context, step) => ({
  actionState: await invokeAgreementEndpointStep({
    actionState: context.actionState,
    callEndpoint: context.callEndpoint,
    context,
    step,
  }),
});

const recordTransition = async (context, step) =>
  recordAgreementItemTransitionStep({
    context,
    step,
  });

const createPaymentClaim = async (context, step) =>
  createAgreementPaymentClaimStep({
    context,
    step,
  });

const emitLifecycleEvent = (context) =>
  emitAgreementLifecycleEventStep({ context });

const stepHandlers = {
  [stepTypes.CALL_ENDPOINT]: callEndpoint,
  [stepTypes.CREATE_PAYMENT_CLAIM]: createPaymentClaim,
  [stepTypes.EMIT_LIFECYCLE_EVENT]: emitLifecycleEvent,
  [stepTypes.RECORD_TRANSITION]: recordTransition,
};

const createProcessingContext = ({
  action,
  callEndpoint,
  executedAt,
  agreement,
  command,
  createCorrelationId,
  createId,
  generateClaimId,
  item,
  previousItemState,
  previousVersion,
  session,
}) => ({
  action,
  actionState: {},
  callEndpoint,
  executedAt,
  agreement,
  command,
  createCorrelationId,
  createId,
  generateClaimId,
  item,
  previousItemState,
  previousVersion,
  publication: {},
  session,
});

const runStep = async (context, step) => {
  const stepType = getStepType(step);
  const handler = stepHandlers[stepType];

  if (!handler) {
    throw Boom.badRequest(`Unknown Agreement processing step "${stepType}"`);
  }

  return {
    ...context,
    ...(await handler(context, step)),
  };
};

export const runAgreementProcessingSteps = async ({
  action,
  callEndpoint,
  executedAt,
  agreement,
  command,
  createCorrelationId,
  createId,
  generateClaimId,
  item,
  previousItemState,
  previousVersion,
  session,
}) => {
  let currentContext = createProcessingContext({
    action,
    callEndpoint,
    executedAt,
    agreement,
    command,
    createCorrelationId,
    createId,
    generateClaimId,
    item,
    previousItemState,
    previousVersion,
    session,
  });

  for (const step of action.processingSteps ?? []) {
    currentContext = await runStep(currentContext, step);
  }

  return currentContext;
};
