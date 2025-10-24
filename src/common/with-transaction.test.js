import Boom from "@hapi/boom";
import { describe, expect, it, vi } from "vitest";
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
    const transactionSpy = vi.fn().mockImplementation();

    await withTransaction(transactionSpy);

    expect(mockSession.withTransaction).toHaveBeenCalledWith(
      transactionSpy,
      transactionOptions,
    );
    expect(transactionSpy).toHaveBeenCalled();
    expect(mockSession.endSession).toHaveBeenCalled();
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
      transactionSpy,
      transactionOptions,
    );
    expect(mockSession.endSession).toHaveBeenCalled();
  });
});
