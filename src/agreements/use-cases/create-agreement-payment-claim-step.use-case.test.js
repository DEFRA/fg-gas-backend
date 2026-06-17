import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgreementPaymentClaimStep } from "./create-agreement-payment-claim-step.use-case.js";
import { prepareAgreementPaymentClaim } from "./prepare-agreement-payment-claim.use-case.js";

vi.mock("./prepare-agreement-payment-claim.use-case.js");

describe("create Agreement payment claim effect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates payment claim output from configured payment path", async () => {
    const preparedPaymentClaim = {
      claimId: "R00000001",
      correlationId: "agreement-correlation-id",
      payment: {
        agreementTotalPence: 10000,
      },
    };
    const createCorrelationId = vi.fn();
    const generateClaimId = vi.fn();
    prepareAgreementPaymentClaim.mockResolvedValue(preparedPaymentClaim);

    await expect(
      createAgreementPaymentClaimStep({
        context: {
          createCorrelationId,
          generateClaimId,
          outputs: {
            paymentPreparation: {
              payment: {
                agreementTotalPence: 10000,
              },
            },
          },
          previousItemState: {
            status: "offered",
          },
          publication: {
            lifecycleEvent: true,
          },
          session: "session",
        },
        effect: {
          params: {
            payment: "$.outputs.paymentPreparation.payment",
            paymentClaim: {
              deliveryBody: "RP00",
              scheme: "SFI",
            },
          },
        },
      }),
    ).resolves.toEqual({
      output: preparedPaymentClaim,
      publication: {
        lifecycleEvent: true,
        paymentClaim: {
          deliveryBody: "RP00",
          scheme: "SFI",
        },
      },
    });

    expect(prepareAgreementPaymentClaim).toHaveBeenCalledWith({
      createCorrelationId,
      generateClaimId,
      payment: {
        agreementTotalPence: 10000,
      },
      previousItemState: {
        status: "offered",
      },
      session: "session",
    });
  });

  it("can create payment claims from the Agreement item payload", async () => {
    prepareAgreementPaymentClaim.mockResolvedValue({
      claimId: "R00000001",
    });

    await createAgreementPaymentClaimStep({
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
        publication: {},
      },
      effect: {
        params: {
          payment: "$.item.payload.answers.payment",
        },
      },
    });

    expect(prepareAgreementPaymentClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        payment: {
          agreementTotalPence: 10000,
        },
      }),
    );
  });

  it("creates payment claims from raw funding calculation data", async () => {
    prepareAgreementPaymentClaim.mockResolvedValue({
      claimId: "R00000001",
    });

    await createAgreementPaymentClaimStep({
      context: {
        executedAt: "2026-06-15T10:00:00.000Z",
        outputs: {},
        previousItemState: {
          fundingCalculation: {
            grandTotal: 1325,
            items: [
              {
                description: "Large White Pig",
                total: 250,
                type: "largeWhite",
              },
            ],
          },
        },
        publication: {},
      },
      effect: {
        params: {
          fundingCalculation: "$.previousItemState.fundingCalculation",
          mapping: {
            itemAmount: "$.total",
            itemDescription: "$.description",
            itemKey: "$.type",
            items: "$.items",
            total: "$.grandTotal",
          },
          schedule: {
            durationMonths: 12,
            paymentOffsetMonths: 1,
            start: "firstDayOfNextMonth",
          },
        },
      },
    });

    expect(prepareAgreementPaymentClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        payment: {
          agreementEndDate: "2027-06-30",
          agreementLevelItems: {
            largeWhite: {
              annualPaymentPence: 25000,
              code: "largeWhite",
              description: "Large White Pig",
            },
          },
          agreementStartDate: "2026-07-01",
          agreementTotalPence: 132500,
          currency: "GBP",
          payments: [
            {
              lineItems: [
                {
                  agreementLevelItemId: "largeWhite",
                  paymentPence: 25000,
                },
              ],
              paymentDate: "2026-08-01",
              totalPaymentPence: 132500,
            },
          ],
        },
      }),
    );
  });
});
