import { afterEach, describe, expect, it, vi } from "vitest";
import { wreck } from "../../../common/wreck.js";
import { ReferenceDataDeclaration } from "../../models/reference-data-declaration.js";
import { loadEndpointReferenceData } from "./endpoint.source.js";

vi.mock("../../../common/wreck.js");

const declaration = new ReferenceDataDeclaration({
  name: "fly-endpoint",
  source: {
    type: "endpoint",
    endpoint: {
      method: "GET",
      path: "/reference/fly",
      service: "GRANT_FUNDING_CALCULATOR",
    },
    output: {
      items: {
        itemsRef: "$.response.options",
        items: { code: "@.id", description: "@.label" },
      },
    },
  },
});

describe("loadEndpointReferenceData", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("calls the named service and maps its answer to items", async () => {
    vi.stubEnv("GRANT_FUNDING_CALCULATOR_URL", "http://fg-gss-pmf:3001");
    vi.stubEnv("GRANT_FUNDING_CALCULATOR_HEADERS", "x-api-key: secret");
    wreck.get.mockResolvedValue({
      payload: { options: [{ id: "WINGS", label: "Wings" }] },
    });

    const set = await loadEndpointReferenceData({ declaration });

    expect(wreck.get).toHaveBeenCalledWith(
      "http://fg-gss-pmf:3001/reference/fly",
      { headers: { "x-api-key": "secret" }, json: "force" },
    );
    expect(set.toJSON()).toEqual({
      name: "fly-endpoint",
      items: [{ code: "WINGS", description: "Wings" }],
    });
  });

  it("is a configuration fault when the service has no URL", async () => {
    vi.stubEnv("GRANT_FUNDING_CALCULATOR_URL", "");

    await expect(loadEndpointReferenceData({ declaration })).rejects.toThrow(
      /expected env var GRANT_FUNDING_CALCULATOR_URL/,
    );
  });

  it("is a bad gateway when the service cannot be reached", async () => {
    vi.stubEnv("GRANT_FUNDING_CALCULATOR_URL", "http://fg-gss-pmf:3001");
    wreck.get.mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(
      loadEndpointReferenceData({ declaration }),
    ).rejects.toMatchObject({ output: { statusCode: 502 } });
  });

  it("is a bad gateway when the answer maps to unusable items", async () => {
    vi.stubEnv("GRANT_FUNDING_CALCULATOR_URL", "http://fg-gss-pmf:3001");
    wreck.get.mockResolvedValue({
      payload: { options: [{ id: "WINGS" }] },
    });

    await expect(
      loadEndpointReferenceData({ declaration }),
    ).rejects.toMatchObject({ output: { statusCode: 502 } });
  });
});
