import { afterEach, describe, expect, it } from "vitest";
import {
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
