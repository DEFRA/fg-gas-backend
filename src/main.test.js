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
    vi.doMock("./common/logger.js");
    vi.doMock("./auth/seed-access-token.js", () => ({
      seedAccessToken: vi.fn().mockResolvedValue(undefined),
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

    expect(createServer).toHaveBeenCalled();
    expect(mockServer.register).toHaveBeenCalledWith([
      health,
      grants,
      agreements,
      grantAdmin,
    ]);
    expect(mockServer.start).toHaveBeenCalled();
  });

  it("waits for registration, which runs the migrations, before seeding", async () => {
    let finishRegistering;
    mockServer.register.mockReturnValue(
      new Promise((resolve) => {
        finishRegistering = resolve;
      }),
    );

    const { seedAccessToken } = await import("./auth/seed-access-token.js");
    const booting = import("./main.js");

    await new Promise((resolve) => setImmediate(resolve));

    // The initial migration drops access_tokens, so seeding while registration
    // is still in flight would wipe the credential it just wrote.
    expect(seedAccessToken).not.toHaveBeenCalled();

    finishRegistering();
    await booting;

    expect(seedAccessToken).toHaveBeenCalled();
  });

  it("seeds before the server starts serving", async () => {
    await import("./main.js");

    const { seedAccessToken } = await import("./auth/seed-access-token.js");

    expect(seedAccessToken.mock.invocationCallOrder[0]).toBeLessThan(
      mockServer.start.mock.invocationCallOrder[0],
    );
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
