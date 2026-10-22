import { afterEach, describe, expect, it, vi } from "vitest";
import {
  missingEndpointServiceUrls,
  resolveEndpointServiceHeaders,
  resolveEndpointServiceUrl,
  resolveEndpointUrl,
  toServiceAddress,
  validateEndpointServiceUrls,
} from "./resolve-endpoint-service-url.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveEndpointServiceHeaders", () => {
  it("resolves service headers and their environment variable references", () => {
    vi.stubEnv("LAND_GRANTS_TOKEN", "encrypted-token");
    vi.stubEnv(
      "LAND_GRANTS_HEADERS",
      `"x-api-key: api-key,Authorization: Bearer \${LAND_GRANTS_TOKEN}"`,
    );

    expect(resolveEndpointServiceHeaders("LAND_GRANTS")).toEqual({
      "x-api-key": "api-key",
      Authorization: "Bearer encrypted-token",
    });
  });

  it("throws when a referenced environment variable is undefined", () => {
    vi.stubEnv(
      "LAND_GRANTS_HEADERS",
      `Authorization: Bearer \${MISSING_TOKEN}`,
    );

    expect(() => resolveEndpointServiceHeaders("LAND_GRANTS")).toThrow(
      /Environment variable MISSING_TOKEN .* is not defined/,
    );
  });

  it("throws when a header has no separator", () => {
    vi.stubEnv("LAND_GRANTS_HEADERS", "invalid-header");

    expect(() => resolveEndpointServiceHeaders("LAND_GRANTS")).toThrow(
      "Invalid service header format",
    );
  });
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

describe("missingEndpointServiceUrls", () => {
  it("lists the URL env vars of referenced services that are not configured", () => {
    vi.stubEnv("SERVICE_A_URL", "http://service-a");

    expect(
      missingEndpointServiceUrls([
        { endpoints: [{ service: "SERVICE_A" }, { service: "SERVICE_B" }] },
        { endpoints: [{ service: "SERVICE_B" }] },
      ]),
    ).toEqual(["SERVICE_B_URL"]);
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

  it("validates services declared by endpoint Process Definitions", () => {
    expect(() =>
      validateEndpointServiceUrls([
        {
          processDefinitions: {
            calculate: {
              type: "endpoint",
              endpoint: { service: "PROCESS_SERVICE" },
            },
          },
        },
      ]),
    ).toThrow(
      /^Missing required endpoint URL env var\(s\): PROCESS_SERVICE_URL$/,
    );
  });

  it("treats a definition with no endpoints as having nothing to validate", () => {
    expect(() => validateEndpointServiceUrls([{}])).not.toThrow();
  });
});

describe("missingEndpointServiceUrls", () => {
  it("names the URL env var of each unconfigured service once, root endpoints first", () => {
    vi.stubEnv("SERVICE_A_URL", "http://service-a");

    expect(
      missingEndpointServiceUrls([
        {
          endpoints: [
            { service: "SERVICE_A" },
            { service: "SERVICE_B" },
            { service: "SERVICE_B" },
          ],
          processDefinitions: {
            calculate: {
              type: "endpoint",
              endpoint: { service: "PROCESS_SERVICE" },
            },
            decide: { type: "rule" },
          },
        },
      ]),
    ).toEqual(["SERVICE_B_URL", "PROCESS_SERVICE_URL"]);
  });

  it("is empty when every service has a URL configured", () => {
    vi.stubEnv("SERVICE_A_URL", "http://service-a");

    expect(
      missingEndpointServiceUrls([{ endpoints: [{ service: "SERVICE_A" }] }]),
    ).toEqual([]);
  });
});

describe("resolveEndpointUrl", () => {
  it("joins the configured base, as configured, to the endpoint path", () => {
    vi.stubEnv("LAND_DATA_URL", "https://u:p@land-data/base/?k=v");

    expect(
      resolveEndpointUrl({ service: "LAND_DATA", path: "/parcels/{sbi}" }),
    ).toBe("https://u:p@land-data/base/?k=v/parcels/{sbi}");
  });

  it("collapses one trailing slash and adds a missing leading one", () => {
    vi.stubEnv("LAND_DATA_URL", "http://land-data/");

    expect(resolveEndpointUrl({ service: "LAND_DATA", path: "parcels" })).toBe(
      "http://land-data/parcels",
    );
  });

  it("throws when the service has no URL configured", () => {
    expect(() =>
      resolveEndpointUrl({ service: "UNKNOWN_SERVICE", path: "/x" }),
    ).toThrow(/No URL configured for service "UNKNOWN_SERVICE"/);
  });
});

describe("toServiceAddress", () => {
  const endpoint = { service: "LAND_DATA", path: "/x/{sbi}" };

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["unparseable", "not a url"],
  ])("is null when the service URL is %s", (_case, value) => {
    vi.stubEnv("LAND_DATA_URL", value);

    expect(toServiceAddress(endpoint)).toBeNull();
  });

  it("keeps only the scheme, host and path of the base, then the path as written", () => {
    vi.stubEnv("LAND_DATA_URL", "https://u:p@h:8443/base/?k=v#f");

    expect(toServiceAddress(endpoint)).toBe("https://h:8443/base/x/{sbi}");
  });

  it("collapses one trailing slash and adds a missing leading one", () => {
    vi.stubEnv("LAND_DATA_URL", "https://h/base");

    expect(toServiceAddress({ service: "LAND_DATA", path: "x" })).toBe(
      "https://h/base/x",
    );
  });

  it("never carries the service's headers", () => {
    vi.stubEnv("LAND_DATA_URL", "https://h/base");
    vi.stubEnv("LAND_DATA_HEADERS", "Authorization: header-sentinel");

    expect(toServiceAddress(endpoint)).not.toContain("header-sentinel");
  });
});
