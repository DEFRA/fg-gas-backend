import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveEndpointServiceUrl,
  validateEndpointServiceUrls,
} from "./resolve-endpoint-service-url.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveEndpointServiceUrl", () => {
  it("resolves a service code to its {SERVICE}_URL env var", () => {
    vi.stubEnv(
      "GRANT_FUNDING_CALCULATOR_URL",
      "http://grant-funding-calculator",
    );

    expect(resolveEndpointServiceUrl("GRANT_FUNDING_CALCULATOR")).toBe(
      "http://grant-funding-calculator",
    );
  });

  it("throws when the env var is unset", () => {
    expect(() => resolveEndpointServiceUrl("UNKNOWN_SERVICE")).toThrow(
      /No URL configured for service "UNKNOWN_SERVICE"/,
    );
  });
});

describe("validateEndpointServiceUrls", () => {
  it("does not throw when every referenced service has a URL configured", () => {
    vi.stubEnv("SERVICE_A_URL", "http://service-a");
    vi.stubEnv("SERVICE_B_URL", "http://service-b");

    expect(() =>
      validateEndpointServiceUrls([
        { endpoints: [{ service: "SERVICE_A" }] },
        { endpoints: [{ service: "SERVICE_B" }] },
      ]),
    ).not.toThrow();
  });

  it("throws listing every missing env var when one or more services have no URL configured", () => {
    vi.stubEnv("SERVICE_A_URL", "http://service-a");

    expect(() =>
      validateEndpointServiceUrls([
        { endpoints: [{ service: "SERVICE_A" }, { service: "SERVICE_B" }] },
      ]),
    ).toThrow(/Missing required endpoint URL env var\(s\): SERVICE_B_URL/);
  });

  it("dedupes a service referenced by multiple definitions/endpoints", () => {
    expect(() =>
      validateEndpointServiceUrls([
        { endpoints: [{ service: "SHARED_SERVICE" }] },
        { endpoints: [{ service: "SHARED_SERVICE" }] },
      ]),
    ).toThrow(
      /^Missing required endpoint URL env var\(s\): SHARED_SERVICE_URL$/,
    );
  });

  it("treats a definition with no endpoints as having nothing to validate", () => {
    expect(() => validateEndpointServiceUrls([{}])).not.toThrow();
  });
});
