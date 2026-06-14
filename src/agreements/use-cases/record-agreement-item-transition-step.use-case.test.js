import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordAgreementItemTransitionStep } from "./record-agreement-item-transition-step.use-case.js";
import { recordAgreementItemTransition } from "./record-agreement-item-transition.use-case.js";

vi.mock("./record-agreement-item-transition.use-case.js");

describe("record Agreement item transition step", () => {
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
          actionState: {
            paymentClaim: {
              claimId: "R00000001",
              correlationId: "agreement-correlation-id",
              originalInvoiceNumber: "",
              payment: {
                agreementTotalPence: 10000,
              },
            },
          },
          command: {
            acceptedBy: "applicant",
          },
          createId: () => "version-2",
          executedAt: "2026-06-01T10:00:00.000Z",
          item: {
            agreementItemId: "agreement-item-id",
          },
          previousVersion: {
            id: "version-1",
          },
          session: "session",
        },
        step: {
          fromStatus: "offered",
          itemPatch: {
            acceptedAt: "$.executedAt",
            acceptedBy: "$.command.acceptedBy",
            claimId: "$.action.paymentClaim.claimId",
            correlationId: "$.action.paymentClaim.correlationId",
            originalInvoiceNumber:
              "$.action.paymentClaim.originalInvoiceNumber",
            payment: "$.action.paymentClaim.payment",
          },
          toStatus: "accepted",
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
        changedBy: "applicant",
        changeType: undefined,
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

  it("allows configured transition metadata to override defaults", async () => {
    recordAgreementItemTransition.mockResolvedValue({
      id: "version-2",
    });

    await recordAgreementItemTransitionStep({
      context: {
        actionState: {},
        command: {
          acceptedBy: "applicant",
        },
        item: {
          agreementItemId: "agreement-item-id",
        },
        session: "session",
      },
      step: {
        changedBy: "admin",
        changeType: "manually-accepted",
        fromStatus: "offered",
        toStatus: "accepted",
      },
    });

    expect(recordAgreementItemTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        changedBy: "admin",
        changeType: "manually-accepted",
      }),
      "session",
    );
  });
});
