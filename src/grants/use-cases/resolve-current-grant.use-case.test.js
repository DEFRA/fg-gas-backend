import { beforeEach, describe, expect, it, vi } from "vitest";
import { findLatestForMajor } from "../repositories/config-version.repository.js";
import { findByCode } from "../repositories/grant.repository.js";
import { resolveAndFetchGrant } from "../services/resolve-config-version.service.js";
import {
  __clearGrantDefinitionCache,
  resolveCurrentGrantUseCase,
} from "./resolve-current-grant.use-case.js";

vi.mock("../../common/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../repositories/config-version.repository.js");
vi.mock("../repositories/grant.repository.js");
vi.mock("../services/resolve-config-version.service.js");

const aGrant = (overrides = {}) => ({
  code: "pigs-might-fly",
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

    expect(result).toEqual({ grant, resolvedVersion: null });
    expect(findByCode).toHaveBeenCalledWith("pigs-might-fly");
    expect(resolveAndFetchGrant).not.toHaveBeenCalled();
  });

  it("rolls forward to the latest version within the same major", async () => {
    const grant = aGrant();
    findLatestForMajor.mockResolvedValue({ version: "1.2.3" });
    resolveAndFetchGrant.mockResolvedValue({
      grant,
      resolvedVersion: "1.2.3",
    });

    const result = await resolveCurrentGrantUseCase("pigs-might-fly", "1.0.0");

    expect(result).toEqual({ grant, resolvedVersion: "1.2.3" });
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
    });
    const memo = new Map();

    await resolveCurrentGrantUseCase("pigs-might-fly", "1.0.0", memo);
    await resolveCurrentGrantUseCase("pigs-might-fly", "1.0.1", memo);

    expect(findLatestForMajor).toHaveBeenCalledTimes(1);
    expect(resolveAndFetchGrant).toHaveBeenCalledTimes(1);
  });
});
