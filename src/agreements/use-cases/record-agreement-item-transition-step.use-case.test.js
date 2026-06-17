import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordAgreementItemTransitionStep } from "./record-agreement-item-transition-step.use-case.js";
import { recordAgreementItemTransition } from "./record-agreement-item-transition.use-case.js";

vi.mock("./record-agreement-item-transition.use-case.js");

describe("snapshot Agreement item transition effect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records a configured transition with resolved Agreement item patch", async () => {
    const version = {
      id: "version-2",
    };
    recordAgreementItemTransition.mockResolvedValue(version);

    await expect(
      recordAgreementItemTransitionStep({
        context: {
          command: {
            acceptedBy: "applicant",
          },
          createId: () => "version-2",
          executedAt: "2026-06-01T10:00:00.000Z",
          item: {
            agreementItemId: "agreement-item-id",
          },
          outputs: {
            paymentClaim: {
              claimId: "R00000001",
              correlationId: "agreement-correlation-id",
              originalInvoiceNumber: "",
              payment: {
                agreementTotalPence: 10000,
              },
            },
          },
          previousVersion: {
            id: "version-1",
          },
          session: "session",
        },
        effect: {
          fromStatus: "offered",
          params: {
            acceptedAt: "$.executedAt",
            acceptedBy: "$.command.acceptedBy",
            claimId: "$.outputs.paymentClaim.claimId",
            correlationId: "$.outputs.paymentClaim.correlationId",
            originalInvoiceNumber:
              "$.outputs.paymentClaim.originalInvoiceNumber",
            payment: "$.outputs.paymentClaim.payment",
          },
          target: "accepted",
        },
      }),
    ).resolves.toEqual({
      status: "accepted",
      version,
    });

    expect(recordAgreementItemTransition).toHaveBeenCalledWith(
      {
        agreementItemId: "agreement-item-id",
        changedAt: "2026-06-01T10:00:00.000Z",
        createId: expect.any(Function),
        fromStatus: "offered",
        itemPatch: {
          acceptedAt: "2026-06-01T10:00:00.000Z",
          acceptedBy: "applicant",
          claimId: "R00000001",
          correlationId: "agreement-correlation-id",
          originalInvoiceNumber: "",
          payment: {
            agreementTotalPence: 10000,
          },
        },
        previousVersion: {
          id: "version-1",
        },
        toStatus: "accepted",
      },
      "session",
    );
  });
});
