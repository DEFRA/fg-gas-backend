import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canHandleInternally,
  clearInternalMessageHandlers,
  dispatchInternalMessage,
  registerInternalMessageHandler,
} from "./internal-message-bus.js";

const register = (overrides = {}) => {
  const handler = vi.fn().mockResolvedValue();
  registerInternalMessageHandler({
    type: "agreement.create",
    handler,
    ...overrides,
  });

  return handler;
};

describe("internal-message-bus", () => {
  afterEach(() => {
    clearInternalMessageHandlers();
  });

  it("reports when no handler can accept a message", () => {
    expect(canHandleInternally({ type: "agreement.create", data: {} })).toBe(
      false,
    );
  });

  it("dispatches a qualified message type to its registered handler", async () => {
    const handler = register();
    const message = {
      type: "cloud.defra.dev.gas.agreement.create",
      data: { code: "pigs-might-fly" },
    };

    await dispatchInternalMessage(message);

    expect(handler).toHaveBeenCalledWith(message);
  });

  it("uses the registered acceptance rule", async () => {
    const handler = register({
      canHandle: ({ data }) => data.code === "pigs-might-fly",
    });
    const accepted = {
      type: "agreement.create",
      data: { code: "pigs-might-fly" },
    };
    const rejected = {
      type: "agreement.create",
      data: { code: "farming-post-transition-tier" },
    };

    expect(canHandleInternally(accepted)).toBe(true);
    expect(canHandleInternally(rejected)).toBe(false);
    await expect(dispatchInternalMessage(rejected)).rejects.toThrow(
      'No internal message handler registered for "agreement.create"',
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("replaces an existing registration for the same type", async () => {
    const first = register();
    const second = register();
    const message = { type: "agreement.create", data: {} };

    await dispatchInternalMessage(message);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(message);
  });

  it("clears all registered handlers", () => {
    register();
    clearInternalMessageHandlers();

    expect(canHandleInternally({ type: "agreement.create", data: {} })).toBe(
      false,
    );
  });
});
