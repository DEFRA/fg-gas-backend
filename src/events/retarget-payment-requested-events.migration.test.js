import { expect, it, vi } from "vitest";
import { up } from "../../migrations/20260925120000-retarget-payment-requested-events.js";

it("retargets legacy internal Payment request events", async () => {
  const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const collection = vi.fn().mockReturnValue({ updateMany });

  await up({ collection });

  expect(collection).toHaveBeenCalledWith("outbox");
  expect(updateMany).toHaveBeenCalledOnce();
  expect(updateMany).toHaveBeenCalledWith(
    {
      target: {
        $in: ["internal:message-bus", "internal:event-bus"],
      },
      "event.type": /\.(claim|agreement)\.payment\.requested$/,
    },
    { $set: { target: "internal:event" } },
  );
});
