import { beforeEach, describe, expect, it, vi } from "vitest";
import { allocateNextSequence } from "../repositories/counter.repository.js";
import { insertPayment } from "../repositories/payment.repository.js";
import { createClaimPaymentUseCase } from "./create-claim-payment.use-case.js";

vi.mock("../repositories/counter.repository.js", async (importOriginal) => ({
  ...(await importOriginal()),
  allocateNextSequence: vi.fn(),
}));
vi.mock("../repositories/payment.repository.js");

const request = {
  code: "woodland",
  clientRef: "wmp-tu3-lbj",
  clientClaimRef: "WMP-TU3-LBJ-C01",
  entitlementId: "5abb45b1-6679-4a5e-92f5-3d13d7b4b74e",
  agreementNumber: "WMP-WMPTU3LBJ",
  agreementVersion: 3,
  correlationId: "123e4567-e89b-12d3-a456-426614174000",
  resolved: {
    sbi: "113593357",
    frn: "1100943757",
    originalInvoiceNumber: "",
    scheme: "WMP",
    sourceSystem: "WMP",
    deliveryBody: "RP10",
    fesCode: "FALS_WMP",
    ledger: "AP",
    totalAmountPence: 150000,
    currency: "GBP",
    marketingYear: "2026",
    payments: [
      {
        dueDate: "2026-09-10",
        totalAmountPence: 150000,
        invoiceLines: [
          {
            schemeCode: "WMP",
            description: "Woodland Management Plan Payment",
            amountPence: 150000,
            accountCode: "SOS710",
            fundCode: "DRD10",
            deliveryBody: "RP10",
            marketingYear: "2026",
          },
        ],
      },
    ],
  },
};

const session = {};

describe("createClaimPaymentUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allocateNextSequence.mockResolvedValue(7);
  });

  it("allocates the claim ID and inserts the Payment on the caller's session", async () => {
    const { payment } = await createClaimPaymentUseCase(request, session);

    expect(allocateNextSequence).toHaveBeenCalledWith("claimIds", session);
    expect(insertPayment).toHaveBeenCalledWith(payment, session);
    expect(payment).toMatchObject({
      source: {
        type: "claim",
        code: "woodland",
        clientRef: "wmp-tu3-lbj",
        clientClaimRef: "WMP-TU3-LBJ-C01",
        entitlementId: "5abb45b1-6679-4a5e-92f5-3d13d7b4b74e",
        agreementNumber: "WMP-WMPTU3LBJ",
        agreementVersion: 3,
      },
      sbi: "113593357",
      frn: "1100943757",
      paymentHubClaimId: "R00000007",
      invoiceNumber: "R00000007-V001QX",
      totalAmountPence: 150000,
    });
  });

  // The Agreement's ID, so the Payment reconciles with the Agreement it was
  // claimed under rather than carrying one of its own.
  it("reports the Correlation ID it was given", async () => {
    const { payment } = await createClaimPaymentUseCase(request, session);

    expect(payment.correlationId).toBe("123e4567-e89b-12d3-a456-426614174000");
  });

  it("refuses to build a Payment without a Correlation ID", async () => {
    await expect(
      createClaimPaymentUseCase(
        { ...request, correlationId: undefined },
        session,
      ),
    ).rejects.toThrow("Correlation ID");
    expect(insertPayment).not.toHaveBeenCalled();
  });

  it("returns the Payment Service publication for the caller to commit", async () => {
    const { payment, publication } = await createClaimPaymentUseCase(
      request,
      session,
    );

    expect(publication).toMatchObject({
      target: "arn:aws:sns:eu-west-2:000000000000:create_payment.fifo",
      segregationRef: "wmp-tu3-lbj",
      event: {
        type: "io.onsite.agreement.create-payment",
        source: "urn:service:agreement",
        data: {
          claimId: payment.paymentHubClaimId,
          grants: [
            {
              agreementNumber: "WMP-WMPTU3LBJ",
              totalAmountPence: "150000",
            },
          ],
        },
      },
    });
    expect(publication.event).not.toHaveProperty("messageGroupId");
  });
});
