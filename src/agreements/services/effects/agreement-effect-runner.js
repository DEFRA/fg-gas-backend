import { agreementEffectHandlers } from "./agreement-effect-registry.js";

// Effect: { name, output?, params? }
// Handler: async (context, effect) => ({ output?, context? })
//
// name selects a handler from the registry.
// output names the context.outputs entry for the handler result.
// params contains handler-specific configuration.
// context contains changes passed to the next effect.
const getEffectHandler = (name) => {
  const handler = agreementEffectHandlers[name];

  if (!handler) {
    throw new Error(
      `Unsupported agreement effect: "${name}". Supported effects are: ${Object.keys(agreementEffectHandlers).join(", ")}`,
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
