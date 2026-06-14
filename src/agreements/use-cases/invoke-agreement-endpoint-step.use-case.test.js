import { describe, expect, it, vi } from "vitest";
import { invokeAgreementEndpointStep } from "./invoke-agreement-endpoint-step.use-case.js";

describe("invoke Agreement endpoint step", () => {
  it("calls a configured endpoint with resolved parameters and stores selected output", async () => {
    const callEndpoint = vi.fn().mockResolvedValue({
      payment: {
        agreementTotalPence: 20000,
      },
    });

    await expect(
      invokeAgreementEndpointStep({
        actionState: {},
        callEndpoint,
        context: {
          item: {
            payload: {
              answers: {
                payment: {
                  agreementTotalPence: 10000,
                },
              },
            },
          },
        },
        step: {
          endpoint: {
            code: "calculate-payment-schedule",
            endpointParams: {
              BODY: {
                payment: "$.item.payload.answers.payment",
              },
            },
            method: "POST",
            path: "/api/v2/payments/calculate",
            service: "LAND_GRANTS",
          },
          output: {
            path: "payment",
            place: "replace",
            select: "$.response.payment",
          },
        },
      }),
    ).resolves.toEqual({
      payment: {
        agreementTotalPence: 20000,
      },
    });
    expect(callEndpoint).toHaveBeenCalledWith({
      context: expect.objectContaining({
        action: {},
        item: expect.any(Object),
      }),
      endpoint: expect.objectContaining({
        code: "calculate-payment-schedule",
      }),
      params: {
        BODY: {
          payment: {
            agreementTotalPence: 10000,
          },
        },
      },
    });
  });

  it("stores endpoint output on configured targets", async () => {
    await expect(
      invokeAgreementEndpointStep({
        actionState: {
          paymentPreparations: {
            dates: {
              code: "dates",
              result: "kept",
            },
          },
        },
        callEndpoint: vi.fn().mockResolvedValue({
          code: "payment",
          payment: {
            agreementTotalPence: 30000,
          },
        }),
        context: {},
        step: {
          endpoint: {
            code: "calculate-payment-schedule",
          },
          output: {
            select: "$.response",
            target: {
              dataType: "OBJECT",
              key: "code",
              place: "append",
              targetNode: "paymentPreparations",
            },
          },
        },
      }),
    ).resolves.toEqual({
      paymentPreparations: {
        dates: {
          code: "dates",
          result: "kept",
        },
        payment: {
          code: "payment",
          payment: {
            agreementTotalPence: 30000,
          },
        },
      },
    });
  });

  it("rejects endpoint steps when no caller is configured", async () => {
    await expect(
      invokeAgreementEndpointStep({
        actionState: {},
        context: {},
        step: {
          endpoint: {
            code: "calculate-payment-schedule",
          },
        },
      }),
    ).rejects.toThrow("Agreement endpoint caller is not configured");
  });
});
