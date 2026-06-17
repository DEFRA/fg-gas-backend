import { describe, expect, it } from "vitest";
import { getAgreementDefinition } from "./agreement-definition.js";

describe("Agreement definition", () => {
  it("defines PMF as a config-backed Agreement", () => {
    expect(getAgreementDefinition("pigs-might-fly")).toMatchObject({
      code: "pigs-might-fly",
      configVersion: "0.0.1",
      agreementNumberPrefix: "PMF",
      endpoints: [
        {
          code: "calculate-funding",
          method: "POST",
          path: "/grantFundingCalculator",
          service: "GRANT_FUNDING_CALCULATOR",
        },
        {
          code: "calculate-agreement-dates",
          method: "POST",
          path: "/api/v1/wmp/payments/calculate",
          service: "LAND_GRANTS",
        },
      ],
      create: {
        target: "offered",
        effects: [
          {
            name: "callEndpoint",
            output: "fundingCalculation",
            params: {
              endpoint: {
                code: "calculate-funding",
              },
            },
          },
          {
            name: "snapshot",
            params: {
              fundingCalculation: "$.outputs.fundingCalculation",
            },
          },
        ],
      },
      states: {
        offered: {
          on: {
            accept: {
              target: "accepted",
              effects: [
                {
                  name: "createPaymentClaim",
                  output: "paymentClaim",
                  params: {
                    fundingCalculation:
                      "$.previousItemState.fundingCalculation",
                    paymentClaim: expect.objectContaining({
                      deliveryBody: "RP00",
                      sourceSystem: "FPTT",
                    }),
                  },
                },
                {
                  name: "snapshot",
                  params: {
                    acceptedAt: "$.executedAt",
                    acceptedBy: "$.command.acceptedBy",
                    claimId: "$.outputs.paymentClaim.claimId",
                    correlationId: "$.outputs.paymentClaim.correlationId",
                    originalInvoiceNumber:
                      "$.outputs.paymentClaim.originalInvoiceNumber",
                    payment: "$.outputs.paymentClaim.payment",
                  },
                },
                {
                  name: "publish",
                  params: {
                    event: "lifecycle",
                  },
                },
              ],
            },
          },
        },
        accepted: {},
      },
      pages: {
        accept: {
          title: "Accept your agreement offer",
          components: expect.any(Array),
        },
        accepted: {
          title: "Offer accepted",
          components: expect.any(Array),
        },
        offered: {
          title: "Review your agreement offer",
          components: expect.any(Array),
        },
      },
    });
  });

  it("treats unknown Agreement codes as legacy", () => {
    expect(getAgreementDefinition("frps-beta")).toEqual({
      code: "frps-beta",
      source: "legacy",
    });
  });
});
