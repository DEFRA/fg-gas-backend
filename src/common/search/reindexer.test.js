import { setTimeout } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { logger } from "../logger.js";
import { SearchReindexer } from "./reindexer.js";

vi.mock("node:timers/promises");
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../mongo-client.js", () => ({ db: {}, mongoClient: {} }));

const runPasses = async (current, passes = 1) => {
  const reindexer = new SearchReindexer({
    source: { collection: "record_search", declarations: { current } },
    intervalMs: 30_000,
  });
  let remaining = passes;

  setTimeout.mockImplementation(async () => {
    remaining -= 1;

    if (remaining === 0) {
      reindexer.stop();
    }
  });

  reindexer.start();

  await vi.waitFor(() => expect(setTimeout).toHaveBeenCalledTimes(passes));

  return reindexer;
};

describe("SearchReindexer", () => {
  it("wakes every interval, without holding the process open, reading the declarations afresh", async () => {
    const current = vi.fn().mockResolvedValue(new Map());

    await runPasses(current, 2);

    expect(current.mock.calls).toEqual([[{ fresh: true }], [{ fresh: true }]]);
    expect(setTimeout).toHaveBeenCalledWith(30_000, undefined, { ref: false });
  });

  it("logs a failed pass and tries again on the next", async () => {
    const error = new Error("no primary");
    const current = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(new Map());

    await runPasses(current, 2);

    expect(logger.error).toHaveBeenCalledWith(
      error,
      "Error reindexing record_search",
    );
    expect(current).toHaveBeenCalledTimes(2);
  });
});
