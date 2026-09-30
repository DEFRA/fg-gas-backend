import Boom from "@hapi/boom";
import { describe, expect, it, vi } from "vitest";
import { logger } from "./logger.js";
import { mongoClient } from "./mongo-client.js";
import { transactionOptions, withTransaction } from "./with-transaction.js";

vi.mock("./mongo-client.js");

describe("withTransaction", () => {
  it("should call session.withTransaction", async () => {
    const mockSession = {
      withTransaction: vi.fn().mockImplementation((cb, opts) => cb()),
      endSession: vi.fn(),
    };
    vi.spyOn(mongoClient, "startSession").mockReturnValue(mockSession);
    const transactionSpy = vi.fn().mockResolvedValue("callback result");

    const result = await withTransaction(transactionSpy);

    expect(mockSession.withTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      transactionOptions,
    );
    expect(transactionSpy).toHaveBeenCalled();
    expect(mockSession.endSession).toHaveBeenCalled();
    expect(result).toBe("callback result");
  });

  it("should handle errors", async () => {
    const mockSession = {
      withTransaction: vi.fn().mockImplementation((cb, opts) => {
        throw Boom.badRequest("bad request");
      }),
      endSession: vi.fn(),
    };
    vi.spyOn(mongoClient, "startSession").mockReturnValue(mockSession);
    const transactionSpy = vi.fn().mockImplementation();

    try {
      await withTransaction(transactionSpy);
    } catch (e) {
      expect(e.output.payload.message).toBe("bad request");
      expect(e.output.payload.statusCode).toBe(400);
    }

    expect(mockSession.withTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      transactionOptions,
    );
    expect(mockSession.endSession).toHaveBeenCalled();
  });

  it.each([
    ["a 4xx refusal", Boom.preconditionFailed("stale"), 0],
    ["a 5xx Boom", Boom.internal("broken"), 1],
    ["an unexpected error", new Error("broken"), 1],
  ])("logs %s as a failed transaction %i times", async (_, error, times) => {
    vi.spyOn(mongoClient, "startSession").mockReturnValue({
      withTransaction: vi.fn().mockRejectedValue(error),
      endSession: vi.fn(),
    });
    const errorSpy = vi.spyOn(logger, "error");

    await expect(withTransaction(vi.fn())).rejects.toBe(error);

    expect(errorSpy).toHaveBeenCalledTimes(times);
  });
});
