import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestGrant } from "../../../../test/helpers/grants.js";
import { wreck } from "../../../common/wreck.js";
import { loadEndpointReferenceData } from "./endpoint.source.js";

vi.mock("../../../common/wreck.js");

const grant = createTestGrant({
  endpoints: [
    {
      code: "pmf-reference",
      method: "GET",
      service: "GRANT_FUNDING_CALCULATOR",
      path: "/reference/{name}",
      output: {
        items: {
          itemsRef: "$.response.options",
          items: { code: "@.id", description: "@.label" },
        },
      },
    },
  ],
  referenceData: [
    { name: "fly", source: { type: "endpoint", endpoint: "pmf-reference" } },
  ],
});
const declaration = grant.findReferenceData("fly");
const load = () => loadEndpointReferenceData({ grant, declaration });

describe("loadEndpointReferenceData", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("calls the named service at the list's path and maps its answer to items", async () => {
    vi.stubEnv("GRANT_FUNDING_CALCULATOR_URL", "http://fg-gss-pmf:3001");
    vi.stubEnv("GRANT_FUNDING_CALCULATOR_HEADERS", "x-api-key: secret");
    wreck.get.mockResolvedValue({
      payload: { options: [{ id: "WINGS", label: "Wings" }] },
    });

    const set = await load();

    expect(wreck.get).toHaveBeenCalledWith(
      "http://fg-gss-pmf:3001/reference/fly",
      { headers: { "x-api-key": "secret" }, json: "force" },
    );
    expect(set.toJSON()).toEqual({
      name: "fly",
      items: [{ code: "WINGS", description: "Wings" }],
    });
  });

  it("is a configuration fault when the service has no URL", async () => {
    vi.stubEnv("GRANT_FUNDING_CALCULATOR_URL", "");

    await expect(load()).rejects.toThrow(
      /expected env var GRANT_FUNDING_CALCULATOR_URL/,
    );
  });

  it("is a bad gateway when the service cannot be reached", async () => {
    vi.stubEnv("GRANT_FUNDING_CALCULATOR_URL", "http://fg-gss-pmf:3001");
    wreck.get.mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(load()).rejects.toMatchObject({ output: { statusCode: 502 } });
  });

  it("is a bad gateway when the answer maps to unusable items", async () => {
    vi.stubEnv("GRANT_FUNDING_CALCULATOR_URL", "http://fg-gss-pmf:3001");
    wreck.get.mockResolvedValue({ payload: { options: [{ id: "WINGS" }] } });

    await expect(load()).rejects.toMatchObject({ output: { statusCode: 502 } });
  });
});
