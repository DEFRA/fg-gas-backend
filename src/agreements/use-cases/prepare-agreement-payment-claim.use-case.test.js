import { describe, expect, it, vi } from "vitest";
import { prepareAgreementPaymentClaim } from "./prepare-agreement-payment-claim.use-case.js";

describe("prepare Agreement payment claim", () => {
  it("creates missing payment claim facts and payment correlation IDs", async () => {
    const createCorrelationId = vi
      .fn()
      .mockReturnValueOnce("agreement-correlation-id")
      .mockReturnValueOnce("payment-correlation-id");

    await expect(
      prepareAgreementPaymentClaim({
        createCorrelationId,
        generateClaimId: () => "R00000001",
        payment: {
          payments: [
            {
              paymentDate: "2026-08-01",
            },
          ],
        },
        previousItemState: {},
        session: "session",
      }),
    ).resolves.toEqual({
      claimId: "R00000001",
      correlationId: "agreement-correlation-id",
      originalInvoiceNumber: "",
      payment: {
        payments: [
          {
            correlationId: "payment-correlation-id",
            paymentDate: "2026-08-01",
          },
        ],
      },
    });
  });

  it("reuses existing payment claim facts and payment correlation IDs", async () => {
    const createCorrelationId = vi.fn();
    const generateClaimId = vi.fn();

    await expect(
      prepareAgreementPaymentClaim({
        createCorrelationId,
        generateClaimId,
        payment: {
          payments: [
            {
              correlationId: "existing-payment-correlation-id",
              paymentDate: "2026-08-01",
            },
          ],
        },
        previousItemState: {
          claimId: "R00000001",
          correlationId: "existing-agreement-correlation-id",
          originalInvoiceNumber: "ORIG-001",
        },
        session: "session",
      }),
    ).resolves.toEqual({
      claimId: "R00000001",
      correlationId: "existing-agreement-correlation-id",
      originalInvoiceNumber: "ORIG-001",
      payment: {
        payments: [
          {
            correlationId: "existing-payment-correlation-id",
            paymentDate: "2026-08-01",
          },
        ],
      },
    });
    expect(createCorrelationId).not.toHaveBeenCalled();
    expect(generateClaimId).not.toHaveBeenCalled();
  });

  it("rejects missing payment data", async () => {
    await expect(
      prepareAgreementPaymentClaim({
        createCorrelationId: vi.fn(),
        generateClaimId: vi.fn(),
        previousItemState: {},
        session: "session",
      }),
    ).rejects.toThrow("Agreement item is missing payment data");
  });
});
