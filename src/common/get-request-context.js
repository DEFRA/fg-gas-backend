import { AsyncLocalStorage } from "node:async_hooks";

const asyncLocalStorage = new AsyncLocalStorage();

export const withRequestContext = (context, fn) =>
  asyncLocalStorage.run(context, fn);

export const getRequestContext = () => asyncLocalStorage.getStore() ?? null;
