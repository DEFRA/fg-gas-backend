import { callEndpointEffect } from "./handlers/call-endpoint-effect.js";
import { publishEffect } from "./handlers/publish-effect.js";
import { snapshotEffect } from "./handlers/snapshot-effect.js";

// Effect shape: { name, output?, params? }
//   name   — selects the handler (owned by the runner)
//   output — where handler output is stored in context.outputs (owned by the runner)
//   params — handler-specific configuration (owned by the handler)
//
// Handler interface: async (context, effect) => ({ output?, context? })
//   output  — stored at context.outputs[effect.output] when effect.output is set
//   context — fields to merge into the context passed to the next effect
//
// Effects may run inside a retryable MongoDB transaction callback. Direct
// external calls must therefore be safe to repeat. Durable commands and events
// belong in the outbox.
const effectHandlers = {
  snapshot: snapshotEffect,
  publish: publishEffect,
  callEndpoint: callEndpointEffect,
};

const getEffectHandler = (name) => {
  const handler = effectHandlers[name];

  if (!handler) {
    throw new Error(
      `Unsupported agreement effect: "${name}". Supported effects are: ${Object.keys(effectHandlers).join(", ")}`,
    );
  }

  return handler;
};

const mergeEffectResult = (context, effect, result = {}) => ({
  ...context,
  ...(result.context ?? {}),
  outputs: {
    ...context.outputs,
    ...(effect.output !== undefined ? { [effect.output]: result.output } : {}),
  },
});

export const runAgreementEffects = async (effects, context) => {
  let currentContext = {
    ...context,
    outputs: { ...(context.outputs ?? {}) },
  };

  for (const effect of effects) {
    const handler = getEffectHandler(effect.name);
    const handlerResult = await handler(currentContext, effect);

    currentContext = mergeEffectResult(currentContext, effect, handlerResult);
  }

  return currentContext;
};
