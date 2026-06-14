import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgreementPaymentClaimStep } from "./create-agreement-payment-claim-step.use-case.js";
import { prepareAgreementPaymentClaim } from "./prepare-agreement-payment-claim.use-case.js";

vi.mock("./prepare-agreement-payment-claim.use-case.js");

describe("create Agreement payment claim step", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates payment claim action state from configured payment path", async () => {
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
          actionState: {
            paymentPreparation: {
              payment: {
                agreementTotalPence: 10000,
              },
            },
          },
          createCorrelationId,
          generateClaimId,
          previousItemState: {
            status: "offered",
          },
          publication: {
            lifecycleEvent: true,
          },
          session: "session",
        },
        step: {
          payment: "$.action.paymentPreparation.payment",
          paymentClaim: {
            deliveryBody: "RP00",
            scheme: "SFI",
          },
        },
      }),
    ).resolves.toEqual({
      actionState: {
        paymentPreparation: {
          payment: {
            agreementTotalPence: 10000,
          },
        },
        paymentClaim: preparedPaymentClaim,
      },
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
        actionState: {},
        item: {
          payload: {
            answers: {
              payment: {
                agreementTotalPence: 10000,
              },
            },
          },
        },
        publication: {},
      },
      step: {
        payment: "$.item.payload.answers.payment",
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
});
