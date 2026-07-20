import { afterEach, describe, expect, it, vi } from "vitest";
import { internalCommandTypes } from "../../common/internal-command-types.js";
import { internalEventTypes } from "../../common/internal-event-types.js";
import {
  clearInternalMessageHandlers,
  registerInternalMessageHandler,
} from "../../common/internal-message-bus.js";
import {
  dispatchInternally,
  isInternalAgreementCommand,
} from "./outbox-dispatch.service.js";

describe("outbox-dispatch.service", () => {
  afterEach(() => {
    clearInternalMessageHandlers();
    vi.clearAllMocks();
  });

  describe("isInternalAgreementCommand", () => {
    it("identifies PMF create commands for internal delivery", () => {
      const event = {
        type: "cloud.defra.dev.gas.agreement.create",
        data: { code: "pigs-might-fly" },
      };

      expect(isInternalAgreementCommand(event)).toBe(true);
    });

    it("leaves legacy create commands for external delivery", () => {
      const event = {
        type: "cloud.defra.dev.gas.agreement.create",
        data: { code: "farming-post-transition-tier" },
      };

      expect(isInternalAgreementCommand(event)).toBe(false);
    });

    it("does not classify other PMF messages as create commands", () => {
      const event = {
        type: "cloud.defra.dev.gas.agreement.status.updated",
        data: { code: "pigs-might-fly" },
      };

      expect(isInternalAgreementCommand(event)).toBe(false);
    });
  });

  describe("dispatchInternally", () => {
    it("throws when no handler is registered for agreement.create", async () => {
      const event = { type: internalCommandTypes.AGREEMENT_CREATE, data: {} };

      await expect(dispatchInternally(event)).rejects.toThrow(
        'No internal message handler registered for "agreement.create"',
      );
    });

    it("invokes the registered handler, leaving it to manage its own transaction", async () => {
      const handler = vi.fn().mockResolvedValue();
      registerInternalMessageHandler(
        internalCommandTypes.AGREEMENT_CREATE,
        handler,
      );
      const event = {
        type: internalCommandTypes.AGREEMENT_CREATE,
        data: { code: "pigs-might-fly" },
      };

      await dispatchInternally(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it("routes an Agreement lifecycle event to its registered handler", async () => {
      const handler = vi.fn().mockResolvedValue();
      registerInternalMessageHandler(
        internalEventTypes.AGREEMENT_STATUS_UPDATED,
        handler,
      );
      const event = {
        type: "cloud.defra.dev.fg-gas-backend.agreement.status.updated",
        data: { agreementNumber: "PMF823153884", status: "accepted" },
      };

      await dispatchInternally(event);

      expect(handler).toHaveBeenCalledWith(event);
    });
  });
});
