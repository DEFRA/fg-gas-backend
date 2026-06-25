import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mongoClient } from "./mongo-client.js";
import { transactionOptions, withTransaction } from "./with-transaction.js";

vi.mock("./mongo-client.js");
vi.mock("./logger.js", () => ({ logger: { error: vi.fn() } }));

describe("withTransaction", () => {
  let mockSession;

  beforeEach(() => {
    mockSession = {
      withTransaction: vi.fn().mockImplementation((cb) => cb(mockSession)),
      endSession: vi.fn(),
    };
    vi.spyOn(mongoClient, "startSession").mockReturnValue(mockSession);
  });

  it("calls the callback inside session.withTransaction", async () => {
    const callback = vi.fn().mockResolvedValue(undefined);

    await withTransaction(callback);

    expect(mockSession.withTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      transactionOptions,
    );
    expect(callback).toHaveBeenCalledWith(mockSession);
    expect(mockSession.endSession).toHaveBeenCalled();
  });

  it("calls onAudit with session after callback succeeds", async () => {
    const onAudit = vi.fn().mockResolvedValue(undefined);

    await withTransaction(vi.fn().mockResolvedValue(undefined), onAudit);

    expect(onAudit).toHaveBeenCalledWith(mockSession);
  });

  it("calls onAudit without session when transaction fails", async () => {
    mockSession.withTransaction.mockRejectedValue(
      Boom.badRequest("bad request"),
    );
    const onAudit = vi.fn().mockResolvedValue(undefined);

    await expect(withTransaction(vi.fn(), onAudit)).rejects.toThrow(
      "bad request",
    );

    expect(onAudit).toHaveBeenCalledWith();
  });

  it("does not require onAudit", async () => {
    await expect(
      withTransaction(vi.fn().mockResolvedValue(undefined)),
    ).resolves.not.toThrow();
  });

  it("rethrows transaction errors", async () => {
    mockSession.withTransaction.mockImplementation(() => {
      throw Boom.badRequest("bad request");
    });

    await expect(withTransaction(vi.fn())).rejects.toMatchObject({
      output: { statusCode: 400 },
    });

    expect(mockSession.endSession).toHaveBeenCalled();
  });

  it("audit errors on success do not surface to the caller", async () => {
    const onAudit = vi.fn().mockRejectedValue(new Error("audit failed"));

    await expect(
      withTransaction(vi.fn().mockResolvedValue(undefined), onAudit),
    ).resolves.not.toThrow();
  });

  it("audit errors on failure do not surface to the caller", async () => {
    mockSession.withTransaction.mockRejectedValue(new Error("tx failed"));
    const onAudit = vi.fn().mockRejectedValue(new Error("audit failed"));

    await expect(withTransaction(vi.fn(), onAudit)).rejects.toThrow(
      "tx failed",
    );
  });
});
