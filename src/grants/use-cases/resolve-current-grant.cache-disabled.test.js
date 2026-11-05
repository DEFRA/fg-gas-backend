import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/config-version.repository.js");
vi.mock("../services/resolve-config-version.service.js");

const aGrant = () => ({
  code: "pigs-might-fly",
});

describe("resolveCurrentGrantUseCase with cache disabled", () => {
  beforeEach(() => {
    vi.stubEnv("GRANT_DEFINITION_CACHE_ENABLED", "false");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("does not reuse the process cache on repeat resolves", async () => {
    const { findLatestForMajor } =
      await import("../repositories/config-version.repository.js");
    const { resolveAndFetchGrant } =
      await import("../services/resolve-config-version.service.js");
    const { resolveCurrentGrantUseCase, _clearGrantDefinitionCache } =
      await import("./resolve-current-grant.use-case.js");

    const grant = aGrant();
    findLatestForMajor.mockResolvedValue({ version: "1.0.0" });
    resolveAndFetchGrant.mockResolvedValue({
      grant,
      resolvedVersion: "1.0.0",
      definitionSource: "mongodb",
    });

    await resolveCurrentGrantUseCase("pigs-might-fly", "1.0.0");
    await resolveCurrentGrantUseCase("pigs-might-fly", "1.0.0");

    expect(resolveAndFetchGrant).toHaveBeenCalledTimes(2);
    _clearGrantDefinitionCache();
  });
});
