import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearInboxMessageHandlers,
  dispatchInboxMessage,
  registerInboxMessageHandler,
} from "./services/inbox-message-handlers.js";

afterEach(() => clearInboxMessageHandlers());

describe("inbox message handlers", () => {
  it("dispatches by exact message source", async () => {
    const agreementHandler = vi.fn();
    const caseWorkingHandler = vi.fn();
    registerInboxMessageHandler("AS", agreementHandler);
    registerInboxMessageHandler("CW", caseWorkingHandler);
    const message = { source: "AS" };

    await dispatchInboxMessage(message);

    expect(agreementHandler).toHaveBeenCalledWith(message);
    expect(caseWorkingHandler).not.toHaveBeenCalled();
  });

  it("rejects an unowned message source", async () => {
    await expect(dispatchInboxMessage({ source: "unknown" })).rejects.toThrow(
      'No inbox message handler registered for source "unknown"',
    );
  });

  it("rejects competing owners for one source", () => {
    registerInboxMessageHandler("AS", vi.fn());

    expect(() => registerInboxMessageHandler("AS", vi.fn())).toThrow(
      'Inbox message handler already registered for "AS"',
    );
  });
});
