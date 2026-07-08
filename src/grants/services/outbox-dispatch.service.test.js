import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearInternalCommandHandlers,
  registerInternalCommandHandler,
} from "../../common/internal-command-bus.js";
import { internalCommandTypes } from "../../common/internal-command-types.js";
import {
  dispatchInternally,
  isInternalAgreementCommand,
} from "./outbox-dispatch.service.js";

describe("outbox-dispatch.service", () => {
  afterEach(() => {
    clearInternalCommandHandlers();
    vi.clearAllMocks();
  });

  describe("isInternalAgreementCommand", () => {
    it("returns true for a PMF agreement.create command", () => {
      const event = {
        type: "cloud.defra.dev.gas.agreement.create",
        data: { code: "pigs-might-fly" },
      };

      expect(isInternalAgreementCommand(event)).toBe(true);
    });

    it("returns false for a non-PMF agreement.create command (legacy FPTT/WMP)", () => {
      const event = {
        type: "cloud.defra.dev.gas.agreement.create",
        data: { code: "farming-post-transition-tier" },
      };

      expect(isInternalAgreementCommand(event)).toBe(false);
    });

    it("returns false for a non-Agreement event", () => {
      const event = {
        type: "cloud.defra.dev.gas.grant-application.status.updated",
        data: { code: "pigs-might-fly" },
      };

      expect(isInternalAgreementCommand(event)).toBe(false);
    });

    it("returns false when the event has no type", () => {
      expect(isInternalAgreementCommand({ data: {} })).toBe(false);
    });
  });

  describe("dispatchInternally", () => {
    it("throws when no handler is registered for agreement.create", async () => {
      const event = { type: internalCommandTypes.AGREEMENT_CREATE, data: {} };

      await expect(dispatchInternally(event)).rejects.toThrow(
        'No internal command handler registered for "agreement.create"',
      );
    });

    it("invokes the registered handler, leaving it to manage its own transaction", async () => {
      const handler = vi.fn().mockResolvedValue();
      registerInternalCommandHandler(
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
  });
});
