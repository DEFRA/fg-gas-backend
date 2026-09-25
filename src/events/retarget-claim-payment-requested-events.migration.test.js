import { expect, it, vi } from "vitest";
import { up } from "../../migrations/20260925120000-retarget-claim-payment-requested-events.js";

it("retargets legacy ClaimPaymentRequested outbox rows to the event bus", async () => {
  const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const collection = vi.fn().mockReturnValue({ updateMany });

  await up({ collection });

  expect(collection).toHaveBeenCalledWith("outbox");
  expect(updateMany).toHaveBeenCalledWith(
    {
      target: "internal:message-bus",
      "event.type": /\.claim\.payment\.requested$/,
    },
    { $set: { target: "internal:event-bus" } },
  );
});
