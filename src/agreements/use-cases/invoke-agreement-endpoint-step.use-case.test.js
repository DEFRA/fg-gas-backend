import { describe, expect, it, vi } from "vitest";
import { invokeAgreementEndpointStep } from "./invoke-agreement-endpoint-step.use-case.js";

describe("invoke Agreement endpoint effect", () => {
  it("calls a configured endpoint with resolved parameters and returns selected output", async () => {
    const callEndpoint = vi.fn().mockResolvedValue({
      payment: {
        agreementTotalPence: 20000,
      },
    });

    await expect(
      invokeAgreementEndpointStep({
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
          outputs: {},
        },
        effect: {
          params: {
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
              select: "$.response.payment",
            },
          },
        },
      }),
    ).resolves.toEqual({
      output: {
        agreementTotalPence: 20000,
      },
    });
    expect(callEndpoint).toHaveBeenCalledWith({
      context: expect.objectContaining({
        item: expect.any(Object),
        outputs: {},
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
        callEndpoint: vi.fn().mockResolvedValue({
          code: "payment",
          payment: {
            agreementTotalPence: 30000,
          },
        }),
        context: {
          outputs: {
            paymentPreparations: {
              dates: {
                code: "dates",
                result: "kept",
              },
            },
          },
        },
        effect: {
          params: {
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
        },
      }),
    ).resolves.toEqual({
      output: {
        code: "payment",
        payment: {
          agreementTotalPence: 30000,
        },
      },
      outputs: {
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
      },
    });
  });

  it("resolves JSONata endpoint parameters", async () => {
    const callEndpoint = vi.fn().mockResolvedValue({});

    await invokeAgreementEndpointStep({
      callEndpoint,
      context: {
        item: {
          payload: {
            answers: {
              firstCount: 2,
              secondCount: 3,
            },
          },
        },
        outputs: {},
      },
      effect: {
        params: {
          endpoint: {
            code: "calculate-payment",
            endpointParams: {
              BODY: 'jsonata:{"counts": [$.item.payload.answers.firstCount, $.item.payload.answers.secondCount]}',
            },
          },
        },
      },
    });

    expect(callEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          BODY: {
            counts: [2, 3],
          },
        },
      }),
    );
  });

  it("rejects endpoint effects when no caller is configured", async () => {
    await expect(
      invokeAgreementEndpointStep({
        context: {
          outputs: {},
        },
        effect: {
          params: {
            endpoint: {
              code: "calculate-payment-schedule",
            },
          },
        },
      }),
    ).rejects.toThrow("Agreement endpoint caller is not configured");
  });
});
