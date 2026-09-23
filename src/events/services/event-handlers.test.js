import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearEventHandlers,
  dispatchEvent,
  registerEventHandler,
} from "./event-handlers.js";

afterEach(() => clearEventHandlers());

describe("event handlers", () => {
  it("dispatches by exact event type", async () => {
    const agreementHandler = vi.fn();
    const claimHandler = vi.fn();
    registerEventHandler("agreement.payment.requested", agreementHandler);
    registerEventHandler("claim.payment.requested", claimHandler);
    const message = { type: "agreement.payment.requested" };

    await dispatchEvent(message);

    expect(agreementHandler).toHaveBeenCalledWith(message);
    expect(claimHandler).not.toHaveBeenCalled();
  });

  it("rejects an unknown event type", async () => {
    await expect(dispatchEvent({ type: "unknown" })).rejects.toThrow(
      'No event handler registered for type "unknown"',
    );
  });

  it("rejects competing owners for one exact type", () => {
    registerEventHandler("agreement.payment.requested", vi.fn());

    expect(() =>
      registerEventHandler("agreement.payment.requested", vi.fn()),
    ).toThrow(
      'Event handler already registered for type "agreement.payment.requested"',
    );
  });

  it("permits idempotent registration by the same owner", () => {
    const handler = vi.fn();
    registerEventHandler("agreement.payment.requested", handler);

    expect(() =>
      registerEventHandler("agreement.payment.requested", handler),
    ).not.toThrow();
  });
});
