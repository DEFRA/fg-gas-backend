import { callEndpointEffect } from "./handlers/call-endpoint-effect.js";
import { publishEffect } from "./handlers/publish-effect.js";
import { snapshotEffect } from "./handlers/snapshot-effect.js";

// Effects may run inside a retryable MongoDB transaction callback. Direct
// external calls must therefore be safe to repeat. Durable commands and events
// belong in the outbox.
//
// Register new configurable effects here. The Agreement Definition schema
// derives its valid effect names from this registry.
export const agreementEffectHandlers = Object.freeze({
  snapshot: snapshotEffect,
  publish: publishEffect,
  callEndpoint: callEndpointEffect,
});
