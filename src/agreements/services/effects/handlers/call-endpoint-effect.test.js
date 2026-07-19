import { describe, expect, it, vi } from "vitest";
import { callAgreementEndpoint } from "../call-agreement-endpoint.js";
import { callEndpointEffect } from "./call-endpoint-effect.js";

vi.mock("../call-agreement-endpoint.js");

const context = {
  answers: { whitePigsCount: 5 },
  outputs: {},
  endpoints: [
    {
      code: "calculate-funding",
      method: "POST",
      path: "/grantFundingCalculator",
      service: "GRANT_FUNDING_CALCULATOR",
    },
  ],
};

const effect = {
  params: {
    endpoint: {
      code: "calculate-funding",
      endpointParams: {
        BODY: { quantity: "$.answers.whitePigsCount ?? 0" },
      },
    },
  },
};

describe("callEndpointEffect", () => {
  it("finds the endpoint, resolves params and returns its output", async () => {
    const fundingCalculation = {
      items: [{ description: "Large White", total: 320 }],
    };
    callAgreementEndpoint.mockResolvedValue(fundingCalculation);

    const result = await callEndpointEffect(context, effect);

    expect(callAgreementEndpoint).toHaveBeenCalledWith(context.endpoints[0], {
      BODY: { quantity: 5 },
    });
    expect(result).toEqual({ output: fundingCalculation });
  });

  it("throws when the endpoint is not configured", async () => {
    await expect(
      callEndpointEffect({ ...context, endpoints: [] }, effect),
    ).rejects.toThrow(/No endpoint configured for code "calculate-funding"/);

    expect(callAgreementEndpoint).not.toHaveBeenCalled();
  });
});
