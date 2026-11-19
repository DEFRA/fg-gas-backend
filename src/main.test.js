import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockServer = {
  register: vi.fn(),
  start: vi.fn(),
};

describe("main", () => {
  beforeEach(() => {
    vi.resetModules();
    mockServer.register.mockResolvedValue(undefined);
    mockServer.start.mockResolvedValue(undefined);

    vi.doMock("./server.js", () => ({
      createServer: vi.fn().mockResolvedValue(mockServer),
    }));
    vi.doMock("./health/index.js", () => ({ health: { name: "health" } }));
    vi.doMock("./grants/index.js", () => ({ grants: { name: "grants" } }));
    vi.doMock("./agreements/index.js", () => ({
      agreements: { name: "agreements" },
    }));
    vi.doMock("./grant-admin/index.js", () => ({
      grantAdmin: { name: "grant-admin" },
    }));
    vi.doMock("./events/index.js", () => ({ events: { name: "events" } }));
    vi.doMock("./payments/index.js", () => ({
      payments: { name: "payments" },
    }));
    vi.doMock("./test-endpoints/index.js", () => ({
      testEndpoints: { name: "test-endpoints" },
    }));
    vi.doMock("./common/logger.js");
    vi.doMock("./common/config-broker/definition-checks.js", () => ({
      assertDefinitionCheckRegistered: vi.fn(),
    }));
    vi.doMock("./auth/access-token-identity.js", () => ({
      reportAccessTokenIdentity: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("./common/mongo-client.js", () => ({ db: { name: "db" } }));
    vi.doMock("./common/buckets/registry.js", () => ({
      listBuckets: vi.fn().mockReturnValue([{ id: "gas.outbox" }]),
    }));
    vi.doMock("./common/buckets/indexes.js", () => ({
      checkDeclaredIndexes: vi.fn().mockResolvedValue(undefined),
    }));
  });

  afterEach(() => {
    process.removeAllListeners("unhandledRejection");
    process.exitCode = undefined;
  });

  it("creates server, registers plugins, and starts", async () => {
    await import("./main.js");

    const { createServer } = await import("./server.js");
    const { health } = await import("./health/index.js");
    const { grants } = await import("./grants/index.js");
    const { agreements } = await import("./agreements/index.js");
    const { grantAdmin } = await import("./grant-admin/index.js");
    const { events } = await import("./events/index.js");
    const { payments } = await import("./payments/index.js");
    const { testEndpoints } = await import("./test-endpoints/index.js");
    const { assertDefinitionCheckRegistered } =
      await import("./common/config-broker/definition-checks.js");

    expect(createServer).toHaveBeenCalled();
    expect(mockServer.register).toHaveBeenCalledWith([
      health,
      grants,
      agreements,
      grantAdmin,
      testEndpoints,
      events,
      payments,
    ]);
    expect(assertDefinitionCheckRegistered).toHaveBeenCalledWith("payment");
    expect(
      assertDefinitionCheckRegistered.mock.invocationCallOrder[0],
    ).toBeGreaterThan(mockServer.register.mock.invocationCallOrder[0]);
    expect(
      assertDefinitionCheckRegistered.mock.invocationCallOrder[0],
    ).toBeLessThan(mockServer.start.mock.invocationCallOrder[0]);
    expect(mockServer.start).toHaveBeenCalled();
  });

  it("waits for registration, which runs the migrations, before reporting", async () => {
    let finishRegistering;
    mockServer.register.mockReturnValue(
      new Promise((resolve) => {
        finishRegistering = resolve;
      }),
    );

    const { reportAccessTokenIdentity } =
      await import("./auth/access-token-identity.js");
    const booting = import("./main.js");

    await new Promise((resolve) => setImmediate(resolve));

    expect(reportAccessTokenIdentity).not.toHaveBeenCalled();

    finishRegistering();
    await booting;

    expect(reportAccessTokenIdentity).toHaveBeenCalled();
  });

  it("reports access token identity before serving", async () => {
    await import("./main.js");

    const { reportAccessTokenIdentity } =
      await import("./auth/access-token-identity.js");

    expect(reportAccessTokenIdentity.mock.invocationCallOrder[0]).toBeLessThan(
      mockServer.start.mock.invocationCallOrder[0],
    );
  });

  it("checks the declared indexes once started, without waiting for the check", async () => {
    const { checkDeclaredIndexes } =
      await import("./common/buckets/indexes.js");
    checkDeclaredIndexes.mockReturnValue(new Promise(() => {}));

    await import("./main.js");

    expect(checkDeclaredIndexes).toHaveBeenCalledWith({ name: "db" }, [
      { id: "gas.outbox" },
    ]);
    expect(checkDeclaredIndexes.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockServer.start.mock.invocationCallOrder[0],
    );
  });

  it("logs a failed index check, and leaves the exit code alone", async () => {
    const { checkDeclaredIndexes } =
      await import("./common/buckets/indexes.js");
    const failure = new Error("no primary");
    checkDeclaredIndexes.mockRejectedValue(failure);

    await import("./main.js");
    await new Promise((resolve) => setImmediate(resolve));
    const { logger } = await import("./common/logger.js");

    expect(logger.error).toHaveBeenCalledWith(
      failure,
      "Declared index check failed",
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("logs and sets exit code on unhandled rejection", async () => {
    await import("./main.js");
    const { logger } = await import("./common/logger.js");

    const error = new Error("boom");
    process.emit("unhandledRejection", error);

    expect(logger.error).toHaveBeenCalledWith(error, "Unhandled rejection");
    expect(process.exitCode).toBe(1);
  });
});
