import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canHandleInternalCommand,
  clearInternalCommandHandlers,
  dispatchInternally,
  getInternalCommandHandler,
  registerInternalCommandHandler,
} from "./internal-command-bus.js";
import { internalCommandTypes } from "./internal-command-types.js";

describe("internal-command-bus", () => {
  afterEach(() => {
    clearInternalCommandHandlers();
  });

  it("returns undefined when no handler is registered for a type", () => {
    expect(getInternalCommandHandler("agreement.create")).toBeUndefined();
  });

  it("returns the handler registered for a type", () => {
    const handler = () => {};
    registerInternalCommandHandler("agreement.create", handler);

    expect(getInternalCommandHandler("agreement.create")).toBe(handler);
  });

  it("reports whether a handler can handle a command", () => {
    expect(canHandleInternalCommand("agreement.create", { data: {} })).toBe(
      false,
    );

    registerInternalCommandHandler("agreement.create", () => {});
    expect(canHandleInternalCommand("agreement.create", { data: {} })).toBe(
      true,
    );

    registerInternalCommandHandler("agreement.create", () => {}, {
      canHandle: (command) => command.data.code === "pigs-might-fly",
    });
    expect(
      canHandleInternalCommand("agreement.create", {
        data: { code: "pigs-might-fly" },
      }),
    ).toBe(true);
    expect(
      canHandleInternalCommand("agreement.create", {
        data: { code: "woodland" },
      }),
    ).toBe(false);
  });

  it("throws when no handler is registered for a command", async () => {
    const event = { type: internalCommandTypes.AGREEMENT_CREATE, data: {} };

    await expect(dispatchInternally(event)).rejects.toThrow(
      'No internal command handler registered for "agreement.create"',
    );
  });

  it.each([
    [
      internalCommandTypes.AGREEMENT_CREATE,
      internalCommandTypes.AGREEMENT_CREATE,
    ],
    [
      internalCommandTypes.AGREEMENT_STATUS_UPDATED,
      "cloud.defra.dev.gas.agreement.status.updated",
    ],
  ])("dispatches %s events", async (handlerType, eventType) => {
    const handler = vi.fn();
    const event = { type: eventType, data: { code: "pigs-might-fly" } };
    registerInternalCommandHandler(handlerType, handler);

    await dispatchInternally(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it("overwrites a previously registered handler for the same type", () => {
    const first = () => {};
    const second = () => {};
    registerInternalCommandHandler("agreement.create", first);
    registerInternalCommandHandler("agreement.create", second);

    expect(getInternalCommandHandler("agreement.create")).toBe(second);
  });

  it("clears all registered handlers", () => {
    registerInternalCommandHandler("agreement.create", () => {});
    clearInternalCommandHandlers();

    expect(getInternalCommandHandler("agreement.create")).toBeUndefined();
  });
});
