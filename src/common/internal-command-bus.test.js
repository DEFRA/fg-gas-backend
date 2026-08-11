import { afterEach, describe, expect, it } from "vitest";
import {
  canHandleInternalCommand,
  clearInternalCommandHandlers,
  getInternalCommandHandler,
  registerInternalCommandHandler,
} from "./internal-command-bus.js";

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

  it("reports that a registered handler can handle commands by default", () => {
    registerInternalCommandHandler("agreement.create", () => {});

    expect(canHandleInternalCommand("agreement.create", { data: {} })).toBe(
      true,
    );
  });

  it("uses the registered capability to determine whether a handler supports a command", () => {
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

  it("reports that an unregistered command cannot be handled", () => {
    expect(canHandleInternalCommand("agreement.create", { data: {} })).toBe(
      false,
    );
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
