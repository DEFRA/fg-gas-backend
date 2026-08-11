import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearInternalCommandHandlers,
  registerInternalCommandHandler,
} from "../../common/internal-command-bus.js";
import { internalCommandTypes } from "../../common/internal-command-types.js";
import { dispatchInternally } from "./outbox-dispatch.service.js";

describe("outbox-dispatch.service", () => {
  afterEach(() => {
    clearInternalCommandHandlers();
    vi.clearAllMocks();
  });

  describe("dispatchInternally", () => {
    it("throws when no handler is registered for agreement.create", async () => {
      const event = { type: internalCommandTypes.AGREEMENT_CREATE, data: {} };

      await expect(dispatchInternally(event)).rejects.toThrow(
        'No internal command handler registered for "agreement.create"',
      );
    });

    it("dispatches an Agreement lifecycle event to its registered handler", async () => {
      const handler = vi.fn().mockResolvedValue();
      registerInternalCommandHandler(
        internalCommandTypes.AGREEMENT_STATUS_UPDATED,
        handler,
      );
      const event = {
        type: "cloud.defra.dev.gas.agreement.status.updated",
        data: { code: "pigs-might-fly" },
      };

      await dispatchInternally(event);

      expect(handler).toHaveBeenCalledWith(event);
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
