import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findLatestForMajor } from "../repositories/config-version.repository.js";
import { findByCode } from "../repositories/grant.repository.js";
import { resolveAndFetchGrant } from "../services/resolve-config-version.service.js";
import {
  __clearGrantDefinitionCache,
  pinnedVersionOf,
  resolveCurrentGrantUseCase,
  resolveGrantForApplication,
  resolveGrantForSubmission,
} from "./resolve-current-grant.use-case.js";

vi.mock("../../common/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../repositories/config-version.repository.js");
vi.mock("../repositories/grant.repository.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../services/resolve-config-version.service.js");

const { logger } = await import("../../common/logger.js");

const aGrant = (overrides = {}) => ({
  code: "pigs-might-fly",
  ...overrides,
});

const anApplication = (overrides = {}) => ({
  clientRef: "APP-001",
  code: "pigs-might-fly",
  originalConfigVersion: "1.0.0",
  currentConfigVersion: "1.0.0",
  ...overrides,
});

describe("resolveCurrentGrantUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearGrantDefinitionCache();
  });

  it("uses legacy findByCode when there is no pinned version", async () => {
    const grant = aGrant();
    findByCode.mockResolvedValue(grant);

    const result = await resolveCurrentGrantUseCase("pigs-might-fly", null);

    expect(result).toEqual({
      grant,
      resolvedVersion: null,
      definitionSource: "mongodb",
    });
    expect(findByCode).toHaveBeenCalledWith("pigs-might-fly");
    expect(resolveAndFetchGrant).not.toHaveBeenCalled();
  });

  it("rolls forward to the latest version within the same major", async () => {
    const grant = aGrant();
    findLatestForMajor.mockResolvedValue({ version: "1.2.3" });
    resolveAndFetchGrant.mockResolvedValue({
      grant,
      resolvedVersion: "1.2.3",
      definitionSource: "s3",
    });

    const result = await resolveCurrentGrantUseCase("pigs-might-fly", "1.0.0");

    expect(result).toEqual({
      grant,
      resolvedVersion: "1.2.3",
      definitionSource: "s3",
    });
    expect(findLatestForMajor).toHaveBeenCalledWith("pigs-might-fly", 1);
    expect(resolveAndFetchGrant).toHaveBeenCalledWith(
      "pigs-might-fly",
      "1.2.3",
    );
  });

  it("throws badRequest for an invalid semver pinned version", async () => {
    await expect(
      resolveCurrentGrantUseCase("pigs-might-fly", "not-a-version"),
    ).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 400 }),
      }),
    );
  });

  it("throws notFound when no active config version exists for the major", async () => {
    findLatestForMajor.mockResolvedValue(null);

    await expect(
      resolveCurrentGrantUseCase("pigs-might-fly", "1.0.0"),
    ).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 404 }),
      }),
    );
  });

  it("serves the immutable definition from the process cache on repeat calls", async () => {
    const grant = aGrant();
    findLatestForMajor.mockResolvedValue({ version: "1.0.0" });
    resolveAndFetchGrant.mockResolvedValue({
      grant,
      resolvedVersion: "1.0.0",
      definitionSource: "mongodb",
    });

    await resolveCurrentGrantUseCase("pigs-might-fly", "1.0.0");
    await resolveCurrentGrantUseCase("pigs-might-fly", "1.0.0");

    expect(resolveAndFetchGrant).toHaveBeenCalledTimes(1);
  });

  it("resolves once per major when a request memo is supplied", async () => {
    const grant = aGrant();
    findLatestForMajor.mockResolvedValue({ version: "1.0.0" });
    resolveAndFetchGrant.mockResolvedValue({
      grant,
      resolvedVersion: "1.0.0",
      definitionSource: "mongodb",
    });
    const memo = new Map();

    await resolveCurrentGrantUseCase("pigs-might-fly", "1.0.0", memo);
    await resolveCurrentGrantUseCase("pigs-might-fly", "1.0.1", memo);

    expect(findLatestForMajor).toHaveBeenCalledTimes(1);
    expect(resolveAndFetchGrant).toHaveBeenCalledTimes(1);
  });

  it("returns definitionSource 'cache' when served from the process cache", async () => {
    const grant = aGrant();
    findLatestForMajor.mockResolvedValue({ version: "1.0.0" });
    resolveAndFetchGrant.mockResolvedValue({
      grant,
      resolvedVersion: "1.0.0",
      definitionSource: "s3",
    });

    await resolveCurrentGrantUseCase("pigs-might-fly", "1.0.0");
    __clearGrantDefinitionCache();

    findLatestForMajor.mockResolvedValue({ version: "1.0.0" });
    resolveAndFetchGrant.mockResolvedValue({
      grant,
      resolvedVersion: "1.0.0",
      definitionSource: "mongodb",
    });

    const result = await resolveCurrentGrantUseCase("pigs-might-fly", "1.0.0");
    expect(result.definitionSource).toBe("mongodb");
  });
});

describe("resolveGrantForApplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearGrantDefinitionCache();
  });

  it("logs version-match when resolved version equals pinned version", async () => {
    const grant = aGrant();
    const application = anApplication();
    findLatestForMajor.mockResolvedValue({ version: "1.0.0" });
    resolveAndFetchGrant.mockResolvedValue({
      grant,
      resolvedVersion: "1.0.0",
      definitionSource: "cache",
    });

    const result = await resolveGrantForApplication(application);

    expect(result.resolutionType).toBe("version-match");
    expect(result.definitionSource).toBe("cache");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: { action: "application-grant-resolved", outcome: "success" },
        grant: expect.objectContaining({
          resolutionType: "version-match",
          resolvedConfigVersion: "1.0.0",
        }),
      }),
      "Resolved grant configuration for application",
    );
  });

  it("logs roll-forward when resolved version differs from pinned", async () => {
    const grant = aGrant();
    const application = anApplication();
    findLatestForMajor.mockResolvedValue({ version: "1.2.3" });
    resolveAndFetchGrant.mockResolvedValue({
      grant,
      resolvedVersion: "1.2.3",
      definitionSource: "s3",
    });

    const result = await resolveGrantForApplication(application);

    expect(result.resolutionType).toBe("roll-forward");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        grant: expect.objectContaining({
          originalConfigVersion: "1.0.0",
          resolvedConfigVersion: "1.2.3",
          resolutionType: "roll-forward",
        }),
      }),
      "Resolved grant configuration for application",
    );
  });

  it("logs legacy when application has no pinned version", async () => {
    const grant = aGrant();
    const application = anApplication({
      currentConfigVersion: null,
      originalConfigVersion: null,
    });
    findByCode.mockResolvedValue(grant);

    const result = await resolveGrantForApplication(application);

    expect(result.resolutionType).toBe("legacy");
    expect(result.definitionSource).toBe("mongodb");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        grant: expect.objectContaining({
          resolutionType: "legacy",
          definitionSource: "mongodb",
        }),
      }),
      "Resolved grant configuration for application",
    );
  });

  it("throws notFound and logs error when legacy grant is null", async () => {
    const application = anApplication({
      currentConfigVersion: null,
      originalConfigVersion: null,
    });
    findByCode.mockResolvedValue(null);

    await expect(resolveGrantForApplication(application)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 404 }),
      }),
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: { action: "application-grant-resolved", outcome: "failure" },
      }),
      "Failed to resolve grant configuration for application",
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          action: "application-grant-resolved",
        }),
      }),
      expect.any(String),
    );
  });

  it("logs error with requestedVersion on resolution failure", async () => {
    const application = anApplication({
      originalConfigVersion: "1.0.0",
      currentConfigVersion: "1.2.0",
    });
    findLatestForMajor.mockResolvedValue(null);

    await expect(resolveGrantForApplication(application)).rejects.toThrow();

    const errorCall = logger.error.mock.calls.find(
      (c) => c[1] === "Failed to resolve grant configuration for application",
    );
    expect(errorCall).toBeDefined();
    const logObj = errorCall[0];
    expect(logObj.grant.requestedVersion).toBe("1.2.0");
    expect(logObj.grant.resolvedConfigVersion).toBeNull();
    expect(logObj.error.message).toEqual(expect.any(String));
  });

  it("failure log contains no answers, metadata, user IDs, requests or responses", async () => {
    const application = anApplication({
      answers: { q1: "a1" },
      metadata: { extra: "data" },
      userId: "user-99",
    });
    findLatestForMajor.mockResolvedValue(null);

    await expect(resolveGrantForApplication(application)).rejects.toThrow();

    const errorCall = logger.error.mock.calls.find(
      (c) => c[1] === "Failed to resolve grant configuration for application",
    );
    const logObj = errorCall[0];
    expect(logObj).not.toHaveProperty("answers");
    expect(logObj).not.toHaveProperty("metadata");
    expect(logObj).not.toHaveProperty("userId");
    expect(logObj).not.toHaveProperty("request");
    expect(logObj).not.toHaveProperty("response");
  });
});

describe("resolveGrantForSubmission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearGrantDefinitionCache();
  });

  it("logs version-match when resolved equals requested", async () => {
    const grant = aGrant();
    resolveAndFetchGrant.mockResolvedValue({
      grant,
      resolvedVersion: "1.0.0",
      definitionSource: "mongodb",
    });

    const result = await resolveGrantForSubmission({
      code: "pigs-might-fly",
      clientRef: "APP-NEW",
      requestedVersion: "1.0.0",
    });

    expect(result).toEqual({ grant, resolvedVersion: "1.0.0" });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: { action: "application-grant-resolved", outcome: "success" },
        application: { clientRef: "APP-NEW" },
        grant: expect.objectContaining({
          resolutionType: "version-match",
          originalConfigVersion: "1.0.0",
          resolvedConfigVersion: "1.0.0",
        }),
      }),
      "Resolved grant configuration for application",
    );
  });

  it("logs roll-forward when resolved differs from requested", async () => {
    const grant = aGrant();
    resolveAndFetchGrant.mockResolvedValue({
      grant,
      resolvedVersion: "1.2.3",
      definitionSource: "s3",
    });

    const result = await resolveGrantForSubmission({
      code: "pigs-might-fly",
      clientRef: "APP-NEW",
      requestedVersion: "1.0.0",
    });

    expect(result).toEqual({ grant, resolvedVersion: "1.2.3" });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        grant: expect.objectContaining({
          resolutionType: "roll-forward",
          originalConfigVersion: "1.0.0",
          resolvedConfigVersion: "1.2.3",
          definitionSource: "s3",
        }),
      }),
      "Resolved grant configuration for application",
    );
  });

  it("logs error and rethrows on failure", async () => {
    resolveAndFetchGrant.mockRejectedValue(
      Boom.notFound("No active config version"),
    );

    await expect(
      resolveGrantForSubmission({
        code: "pigs-might-fly",
        clientRef: "APP-NEW",
        requestedVersion: "2.0.0",
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 404 }),
      }),
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: { action: "application-grant-resolved", outcome: "failure" },
        application: { clientRef: "APP-NEW" },
        grant: expect.objectContaining({
          code: "pigs-might-fly",
          requestedVersion: "2.0.0",
          resolvedConfigVersion: null,
        }),
        error: { message: expect.any(String) },
      }),
      "Failed to resolve grant configuration for application",
    );
  });
});

describe("pinnedVersionOf", () => {
  it("returns currentConfigVersion when present", () => {
    const application = {
      currentConfigVersion: "1.3.1",
      originalConfigVersion: "0.0.0",
    };
    expect(pinnedVersionOf(application)).toBe("1.3.1");
  });

  it("falls back to originalConfigVersion when currentConfigVersion is null", () => {
    const application = {
      currentConfigVersion: null,
      originalConfigVersion: "1.0.0",
    };
    expect(pinnedVersionOf(application)).toBe("1.0.0");
  });

  it("returns null when both are null", () => {
    const application = {
      currentConfigVersion: null,
      originalConfigVersion: null,
    };
    expect(pinnedVersionOf(application)).toBeNull();
  });
});
