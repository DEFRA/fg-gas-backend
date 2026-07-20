import { applyItemSnapshotEffect } from "../../use-cases/apply-item-snapshot-effect.js";
import { callEndpointEffect } from "./handlers/call-endpoint-effect.js";
import { publishEffect } from "./handlers/publish-effect.js";

const createPaymentClaimEffect = async () => {
  throw new Error("createPaymentClaim handler not yet implemented");
};

// Effects may run inside a retryable MongoDB transaction callback. Direct
// external calls must therefore be side-effect-free and safe to repeat;
// durable external commands and events belong in the outbox.
export const agreementEffectHandlers = {
  snapshot: applyItemSnapshotEffect,
  publish: publishEffect,
  callEndpoint: callEndpointEffect,
  createPaymentClaim: createPaymentClaimEffect,
};
