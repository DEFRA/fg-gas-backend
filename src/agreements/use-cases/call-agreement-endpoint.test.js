import { describe, expect, it, vi } from "vitest";
import { wreck } from "../../common/wreck.js";
import { callAgreementEndpoint } from "./call-agreement-endpoint.js";
import { resolveEndpointServiceUrl } from "./resolve-endpoint-service-url.js";

vi.mock("../../common/wreck.js");
vi.mock("./resolve-endpoint-service-url.js");

const endpointConfig = {
  code: "calculate-funding",
  method: "POST",
  path: "/grantFundingCalculator",
  service: "GRANT_FUNDING_CALCULATOR",
};

describe("callAgreementEndpoint", () => {
  it("resolves the service URL, calls the endpoint, and returns the payload", async () => {
    resolveEndpointServiceUrl.mockReturnValue(
      "http://grant-funding-calculator",
    );
    wreck.request.mockResolvedValue({ statusCode: 200 });
    wreck.read.mockResolvedValue({ amount: 500 });

    const result = await callAgreementEndpoint(endpointConfig, {
      BODY: { pigTypes: [] },
    });

    expect(resolveEndpointServiceUrl).toHaveBeenCalledWith(
      "GRANT_FUNDING_CALCULATOR",
    );
    expect(wreck.request).toHaveBeenCalledWith(
      "POST",
      "http://grant-funding-calculator/grantFundingCalculator",
      {
        headers: { "Content-Type": "application/json" },
        payload: { pigTypes: [] },
        json: true,
      },
    );
    expect(result).toEqual({ amount: 500 });
  });

  it("throws Boom.badGateway on a non-2xx response", async () => {
    resolveEndpointServiceUrl.mockReturnValue(
      "http://grant-funding-calculator",
    );
    wreck.request.mockResolvedValue({ statusCode: 500 });
    wreck.read.mockResolvedValue({ error: "boom" });

    await expect(
      callAgreementEndpoint(endpointConfig, { BODY: {} }),
    ).rejects.toThrow(/non-success status: 500/);
  });

  it("reports the non-2xx status even when the error response body isn't valid JSON, since it never attempts to read a non-2xx body", async () => {
    resolveEndpointServiceUrl.mockReturnValue(
      "http://grant-funding-calculator",
    );
    wreck.request.mockResolvedValue({ statusCode: 500 });
    wreck.read.mockRejectedValue(new Error("Invalid JSON"));

    await expect(
      callAgreementEndpoint(endpointConfig, { BODY: {} }),
    ).rejects.toThrow(/non-success status: 500/);
    expect(wreck.read).not.toHaveBeenCalled();
  });

  it("throws a distinct error when a successful response's body fails to parse", async () => {
    resolveEndpointServiceUrl.mockReturnValue(
      "http://grant-funding-calculator",
    );
    wreck.request.mockResolvedValue({ statusCode: 200 });
    wreck.read.mockRejectedValue(new Error("Invalid JSON"));

    await expect(
      callAgreementEndpoint(endpointConfig, { BODY: {} }),
    ).rejects.toThrow(
      /Failed to parse response from endpoint "calculate-funding"/,
    );
  });

  it("throws Boom.badGateway when the request itself fails", async () => {
    resolveEndpointServiceUrl.mockReturnValue(
      "http://grant-funding-calculator",
    );
    wreck.request.mockRejectedValue(new Error("network down"));

    await expect(
      callAgreementEndpoint(endpointConfig, { BODY: {} }),
    ).rejects.toThrow(/Failed to call endpoint "calculate-funding"/);
  });
});
