import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { Inbox, InboxStatus } from "../../events/models/inbox.js";
import { update } from "../../events/repositories/inbox.repository.js";
import {
  clearEventHandlers,
  registerEventHandler,
} from "../../events/services/event-handlers.js";
import { InboxSubscriber } from "../../events/subscribers/inbox.subscriber.js";
import { CONFIG_VERSION_UPDATED_EVENT_TYPE } from "../events/inbound-event-types.js";
import { handleConfigVersionMessage } from "../handlers/handle-config-version-message.js";
import { upsert } from "../repositories/config-version.repository.js";
import { validateConfigDefinitions } from "./validate-config-definitions.js";

vi.mock("../../common/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    config: {
      ...actual.config,
      configBroker: { ...actual.config.configBroker, variant: "next" },
    },
  };
});
vi.mock("../../common/logger.js");
vi.mock("../../events/repositories/inbox.repository.js");
vi.mock("../repositories/config-version.repository.js");
vi.mock("./validate-config-definitions.js", () => ({
  validateConfigDefinitions: vi.fn(),
}));

beforeEach(() => {
  clearEventHandlers();
  registerEventHandler(
    CONFIG_VERSION_UPDATED_EVENT_TYPE,
    handleConfigVersionMessage,
  );
  update.mockResolvedValue({ matchedCount: 1 });
});

describe("config updates without a GAS definition through the inbox", () => {
  it.each([
    ["no GAS definition", "woodland/1.2.3/cw/cw.json"],
    ["only an unsuffixed GAS definition", "woodland/1.2.3/gas/gas.json"],
  ])(
    "completes an update with %s without a retry or config-version write",
    async (_, key) => {
      const message = new Inbox({
        source: "CB",
        type: CONFIG_VERSION_UPDATED_EVENT_TYPE,
        messageId: "config-without-gas",
        segregationRef: "woodland",
        event: {
          data: {
            grantCode: "woodland",
            version: "1.2.3",
            status: "active",
            s3Bucket: "configs-bucket",
            manifest: [key],
          },
        },
      });

      await new InboxSubscriber().handleEvent(message);

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: InboxStatus.COMPLETED,
          completionAttempts: 0,
          attemptHistory: [],
          lastError: null,
        }),
        undefined,
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Skipping config version: woodland@1.2.3"),
      );
      expect(validateConfigDefinitions).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    },
  );
});
