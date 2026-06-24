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
    vi.doMock("./common/logger.js", () => ({ logger: { error: vi.fn() } }));
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

    expect(createServer).toHaveBeenCalled();
    expect(mockServer.register).toHaveBeenCalledWith([
      health,
      grants,
      agreements,
    ]);
    expect(mockServer.start).toHaveBeenCalled();
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
