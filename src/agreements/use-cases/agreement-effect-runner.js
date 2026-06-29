// Effect shape: { name, output?, params? }
//   name   — selects the handler (owned by the runner)
//   output — where handler output is stored in context.outputs (owned by the runner)
//   params — handler-specific configuration (owned by the handler)
//
// Handler interface: async (context, effect) => ({ output?, context? })
//   output  — stored at context.outputs[effect.output] when effect.output is set
//   context — fields to merge into the context passed to the next effect
const snapshotEffectHandler = async (_context, { params: _params = {} }) => {
  throw new Error("snapshot handler not yet implemented");
};

const callEndpointEffectHandler = async (
  _context,
  { params: _params = {} },
) => {
  throw new Error("callEndpoint handler not yet implemented");
};

const createPaymentClaimEffectHandler = async (
  _context,
  { params: _params = {} },
) => {
  throw new Error("createPaymentClaim handler not yet implemented");
};

const publishEffectHandler = async (_context, { params: _params = {} }) => {
  throw new Error("publish handler not yet implemented");
};

export const handlers = {
  snapshot: snapshotEffectHandler,
  callEndpoint: callEndpointEffectHandler,
  createPaymentClaim: createPaymentClaimEffectHandler,
  publish: publishEffectHandler,
};

export const mergeEffectResult = (context, effect, result = {}) => ({
  ...context,
  ...(result.context ?? {}),
  outputs: {
    ...context.outputs,
    ...(effect.output !== undefined ? { [effect.output]: result.output } : {}),
  },
});

export const runAgreementEffects = async (effects, context) => {
  let currentContext = { ...context, outputs: { ...context.outputs } };

  for (const effect of effects) {
    const handler = handlers[effect.name];

    if (!handler) {
      // using a plain Error instead of Hapi Boom.badImplementation as that will send
      // "An internal server error occurred" to the logs rather than the actual error.
      throw new Error(
        `Unsupported agreement effect: "${effect.name}". Supported effects are: ${Object.keys(handlers).join(", ")}`,
      );
    }

    const handlerResult = await handler(currentContext, effect);

    currentContext = mergeEffectResult(currentContext, effect, handlerResult);
  }

  return currentContext;
};
