import { AsyncLocalStorage } from "node:async_hooks";

const asyncLocalStorage = new AsyncLocalStorage();

export const withTraceParent = (traceParent, fn) =>
  asyncLocalStorage.run(traceParent, fn);

export const getTraceParent = () => asyncLocalStorage.getStore();
