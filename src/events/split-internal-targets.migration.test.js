import { expect, it, vi } from "vitest";
import { up } from "../../migrations/20260925120000-split-internal-targets.js";

it("splits legacy internal outbox rows into event and command targets", async () => {
  const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const collection = vi.fn().mockReturnValue({ updateMany });

  await up({ collection });

  expect(collection).toHaveBeenCalledWith("outbox");
  expect(updateMany).toHaveBeenNthCalledWith(
    1,
    {
      target: {
        $in: ["internal:message-bus", "internal:event-bus"],
      },
      "event.type": /\.(claim|agreement)\.payment\.requested$/,
    },
    { $set: { target: "internal:event" } },
  );
  expect(updateMany).toHaveBeenNthCalledWith(
    2,
    { target: "internal:message-bus" },
    { $set: { target: "internal:command" } },
  );
});
