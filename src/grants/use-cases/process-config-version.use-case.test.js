import { beforeEach, describe, expect, it, vi } from "vitest";
import { processConfigVersionUseCase } from "./process-config-version.use-case.js";

vi.mock("../../common/config.js", () => ({
  config: {
    configBroker: {
      s3Bucket: "config-broker-test",
    },
  },
}));

vi.mock("../../common/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const mockUpsert = vi.fn();
vi.mock("../repositories/config-version.repository.js", () => ({
  upsert: (...args) => mockUpsert(...args),
}));

describe("processConfigVersionUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsert.mockResolvedValue({ upsertedCount: 1 });
  });

  it("should upsert a config version with correct fields", async () => {
    await processConfigVersionUseCase({
      grantCode: "woodland",
      version: "1.2.3",
      status: "active",
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const arg = mockUpsert.mock.calls[0][0];
    expect(arg.grantCode).toBe("woodland");
    expect(arg.version).toBe("1.2.3");
    expect(arg.major).toBe(1);
    expect(arg.minor).toBe(2);
    expect(arg.patch).toBe(3);
    expect(arg.status).toBe("active");
    expect(arg.s3Key).toBe("woodland/1.2.3/gas/gas.json");
    expect(arg.s3Bucket).toBe("config-broker-test");
    expect(arg.fetchStatus).toBe("pending");
  });

  it("should throw when status is missing", async () => {
    await expect(
      processConfigVersionUseCase({
        grantCode: "woodland",
        version: "1.0.0",
      }),
    ).rejects.toThrow("invalid status");
  });

  it("should throw when status is not a recognised value", async () => {
    await expect(
      processConfigVersionUseCase({
        grantCode: "woodland",
        version: "1.0.0",
        status: "published",
      }),
    ).rejects.toThrow("invalid status");
  });

  it("should throw when grantCode is missing", async () => {
    await expect(
      processConfigVersionUseCase({ version: "1.0.0", status: "active" }),
    ).rejects.toThrow("missing required fields");
  });

  it("should throw when version is missing", async () => {
    await expect(
      processConfigVersionUseCase({
        grantCode: "woodland",
        status: "active",
      }),
    ).rejects.toThrow("missing required fields");
  });

  it("should throw for invalid semver version", async () => {
    await expect(
      processConfigVersionUseCase({
        grantCode: "woodland",
        version: "not-a-version",
        status: "active",
      }),
    ).rejects.toThrow("Invalid semver version");
  });

  it("should throw for semver with pre-release suffix", async () => {
    await expect(
      processConfigVersionUseCase({
        grantCode: "woodland",
        version: "1.0.0-rc1",
        status: "active",
      }),
    ).rejects.toThrow("Invalid semver version");
  });

  it("should handle draft status", async () => {
    await processConfigVersionUseCase({
      grantCode: "woodland",
      version: "2.0.0",
      status: "draft",
    });

    const arg = mockUpsert.mock.calls[0][0];
    expect(arg.status).toBe("draft");
  });
});
