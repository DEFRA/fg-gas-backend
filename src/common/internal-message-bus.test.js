import { afterEach, describe, expect, it } from "vitest";
import {
  clearInternalMessageHandlers,
  getInternalMessageHandler,
  registerInternalMessageHandler,
} from "./internal-message-bus.js";

describe("internal-message-bus", () => {
  afterEach(() => {
    clearInternalMessageHandlers();
  });

  it("returns undefined when no handler is registered for a type", () => {
    expect(getInternalMessageHandler("agreement.create")).toBeUndefined();
  });

  it("returns the handler registered for a type", () => {
    const handler = () => {};
    registerInternalMessageHandler("agreement.create", handler);

    expect(getInternalMessageHandler("agreement.create")).toBe(handler);
  });

  it("overwrites a previously registered handler for the same type", () => {
    const first = () => {};
    const second = () => {};
    registerInternalMessageHandler("agreement.create", first);
    registerInternalMessageHandler("agreement.create", second);

    expect(getInternalMessageHandler("agreement.create")).toBe(second);
  });

  it("clears all registered handlers", () => {
    registerInternalMessageHandler("agreement.create", () => {});
    clearInternalMessageHandlers();

    expect(getInternalMessageHandler("agreement.create")).toBeUndefined();
  });
});
