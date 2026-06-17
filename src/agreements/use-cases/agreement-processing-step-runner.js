import Boom from "@hapi/boom";
import { createAgreementPaymentClaimStep } from "./create-agreement-payment-claim-step.use-case.js";
import { emitAgreementLifecycleEventStep } from "./emit-agreement-lifecycle-event-step.use-case.js";
import { invokeAgreementEndpointStep } from "./invoke-agreement-endpoint-step.use-case.js";
import { recordAgreementItemTransitionStep } from "./record-agreement-item-transition-step.use-case.js";

const effectNames = {
  CALL_ENDPOINT: "callEndpoint",
  CREATE_PAYMENT_CLAIM: "createPaymentClaim",
  PUBLISH: "publish",
  SNAPSHOT: "snapshot",
};

const getEffectName = (effect) => effect.name;

const callEndpoint = async (context, effect) =>
  invokeAgreementEndpointStep({
    callEndpoint: context.callEndpoint,
    context,
    effect,
  });

const snapshot = async (context, effect) =>
  recordAgreementItemTransitionStep({
    context,
    effect,
  });

const createPaymentClaim = async (context, effect) =>
  createAgreementPaymentClaimStep({
    context,
    effect,
  });

const getPublishEvent = (effect) => effect.params?.event;

const publish = (context, effect) => {
  const event = getPublishEvent(effect);

  if (event === "lifecycle") {
    return emitAgreementLifecycleEventStep({ context });
  }

  throw Boom.badRequest(`Unknown Agreement publish event "${event}"`);
};

const effectHandlers = {
  [effectNames.CALL_ENDPOINT]: callEndpoint,
  [effectNames.CREATE_PAYMENT_CLAIM]: createPaymentClaim,
  [effectNames.PUBLISH]: publish,
  [effectNames.SNAPSHOT]: snapshot,
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
  callEndpoint,
  executedAt,
  agreement,
  command,
  createCorrelationId,
  createId,
  generateClaimId,
  item,
  outputs: {},
  previousItemState,
  previousVersion,
  publication: {},
  session,
});

const withOutput = ({ context, effect, effectResult }) => {
  if (!effect.output) {
    return context;
  }

  return {
    ...context,
    outputs: {
      ...context.outputs,
      [effect.output]: effectResult.output,
    },
  };
};

const withoutOutput = (effectResult) => {
  const { output: _output, ...contextPatch } = effectResult;

  return contextPatch;
};

const runEffect = async (context, effect) => {
  const effectName = getEffectName(effect);
  const handler = effectHandlers[effectName];

  if (!handler) {
    throw Boom.badRequest(`Unknown Agreement effect "${effectName}"`);
  }

  const effectResult = await handler(context, effect);
  const nextContext = {
    ...context,
    ...withoutOutput(effectResult),
  };

  return withOutput({
    context: nextContext,
    effect,
    effectResult,
  });
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

  for (const effect of action.effects ?? []) {
    currentContext = await runEffect(currentContext, effect);
  }

  return currentContext;
};
