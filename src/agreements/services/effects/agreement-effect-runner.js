import { applyItemSnapshotEffect } from "../../use-cases/apply-item-snapshot-effect.js";
import { callAgreementEndpoint } from "./call-agreement-endpoint.js";
import { createAgreementStatusUpdatedOutboundEvent } from "./create-agreement-status-updated-outbound-event.js";
import { isPlainObject, resolveEffectParams } from "./resolve-effect-params.js";

// Effect shape: { name, output?, params? }
//   name   — selects the handler (owned by the runner)
//   output — where handler output is stored in context.outputs (owned by the runner)
//   params — handler-specific configuration (owned by the handler)
//
// Handler interface: async (context, effect) => ({ output?, context? })
//   output  — stored at context.outputs[effect.output] when effect.output is set
//   context — fields to merge into the context passed to the next effect
//
// context.outputs is frozen before each handler call; writing to it directly throws
// a TypeError. Return { output: value } and set effect.output instead.
const findEndpointConfig = (context, endpointCode) => {
  const endpointConfig = context.endpoints?.find(
    (candidate) => candidate.code === endpointCode,
  );

  if (!endpointConfig) {
    throw new Error(`No endpoint configured for code "${endpointCode}"`);
  }

  return endpointConfig;
};

const callEndpointEffectHandler = async (context, { params = {} }) => {
  const endpointConfig = findEndpointConfig(context, params.endpoint?.code);

  const resolvedParams = await resolveEffectParams(
    params.endpoint.endpointParams ?? {},
    context,
  );

  const output = await callAgreementEndpoint(endpointConfig, resolvedParams);

  return { output };
};

const publishEffectHandler = async (context, { params = {} }) => {
  if (params.event !== "agreementStatusUpdated") {
    throw new Error(`Unsupported Agreement publication: "${params.event}"`);
  }

  return {
    context: {
      outboundEvents: [
        ...(context.outboundEvents ?? []),
        createAgreementStatusUpdatedOutboundEvent(context),
      ],
    },
  };
};

// Effects may run inside a retryable MongoDB transaction callback. Direct
// external calls must therefore be side-effect-free and safe to repeat;
// durable external commands and events belong in the outbox.
export const agreementEffectHandlers = {
  snapshot: applyItemSnapshotEffect,
  publish: publishEffectHandler,
  callEndpoint: callEndpointEffectHandler,
};

// Plain-object context values (e.g. item) are merged key-by-key
// rather than replaced wholesale, so multiple effects that each contribute to
// the same context key (e.g. two item effects in one chain) accumulate
// instead of the later one silently discarding the earlier one's fields.
const mergeContextValue = (existing, incoming) =>
  isPlainObject(existing) && isPlainObject(incoming)
    ? { ...existing, ...incoming }
    : incoming;

const mergeContext = (context, contextPatch) => {
  const mergedContext = { ...context };

  for (const [key, value] of Object.entries(contextPatch)) {
    mergedContext[key] = mergeContextValue(context[key], value);
  }

  return mergedContext;
};

export const mergeEffectResult = (context, effect, result = {}) => ({
  ...mergeContext(context, result.context ?? {}),
  outputs: {
    ...context.outputs,
    ...(effect.output !== undefined ? { [effect.output]: result.output } : {}),
  },
});

export const runAgreementEffects = async (effects, context) => {
  let currentContext = structuredClone({
    ...context,
    outputs: context.outputs ?? {},
  });

  for (const effect of effects) {
    const handler = agreementEffectHandlers[effect.name];

    if (!handler) {
      // using a plain Error instead of Hapi Boom.badImplementation as that will send
      // "An internal server error occurred" to the logs rather than the actual error.
      throw new Error(
        `Unsupported agreement effect: "${effect.name}". Supported effects are: ${Object.keys(agreementEffectHandlers).join(", ")}`,
      );
    }

    const handlerContext = structuredClone(currentContext);
    handlerContext.outputs = Object.freeze(handlerContext.outputs);
    const handlerResult = await handler(handlerContext, effect);

    currentContext = mergeEffectResult(currentContext, effect, handlerResult);
  }

  return currentContext;
};
