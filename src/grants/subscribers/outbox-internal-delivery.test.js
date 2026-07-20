import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearInternalMessageHandlers,
  registerInternalMessageHandler,
} from "../../common/internal-message-bus.js";
import { publish } from "../../common/sns-client.js";
import { update } from "../repositories/outbox.repository.js";
import { OutboxSubscriber } from "./outbox.subscriber.js";

vi.mock("../../common/sns-client.js");
vi.mock("../repositories/outbox.repository.js");

describe("Outbox internal delivery", () => {
  afterEach(() => {
    clearInternalMessageHandlers();
    vi.clearAllMocks();
  });

  it("delivers an Agreement lifecycle event to Grants without publishing to SNS", async () => {
    const handler = vi.fn().mockResolvedValue();
    registerInternalMessageHandler({
      type: "agreement.status.updated",
      handler,
    });
    const event = {
      type: "cloud.defra.local.fg-gas-backend.agreement.status.updated",
      data: {
        agreementNumber: "PMF823153884",
        clientRef: "xnp-rr3-nfb",
        code: "pigs-might-fly",
        status: "accepted",
      },
    };
    const outboxEntry = {
      target: "internal:grants",
      event,
      markAsComplete: vi.fn(),
      markAsFailed: vi.fn(),
    };

    await new OutboxSubscriber().sendEvent(outboxEntry);

    expect(handler).toHaveBeenCalledWith(event);
    expect(publish).not.toHaveBeenCalled();
    expect(outboxEntry.markAsComplete).toHaveBeenCalled();
    expect(outboxEntry.markAsFailed).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
  });
});
