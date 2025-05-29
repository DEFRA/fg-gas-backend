import { getTraceId } from "@defra/hapi-tracing";
import { AsyncLocalStorage } from "node:async_hooks";

const TRACE_PARENT = "traceParent";
const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Wraps method in an AsyncLocalStorage instance
 * making the event.traceparent available in context
 *
 * @param {Function} method
 * @param {String} traceParent
 */
export function wrapTraceParent(method, traceParent) {
  const store = new Map();
  store.set(TRACE_PARENT, traceParent);
  asyncLocalStorage.run(store, method);
}

/**
 * @returns the traceparent ID from an event OR the traceId from the request
 */
export function getTraceParent() {
  const traceParentId = asyncLocalStorage.getStore()?.get(TRACE_PARENT);
  return traceParentId ?? getTraceId();
}
