import { beforeEach, describe, expect, it, vi } from "vitest";
import { allocateNextSequence } from "../repositories/counter.repository.js";
import { insertPayment } from "../repositories/payment.repository.js";
import { createAgreementPaymentUseCase } from "./create-agreement-payment.use-case.js";

vi.mock("../repositories/counter.repository.js", async (importOriginal) => ({
  ...(await importOriginal()),
  allocateNextSequence: vi.fn(),
}));
vi.mock("../repositories/payment.repository.js");

const request = {
  agreementNumber: "PMF123456789",
  version: 2,
  agreementCorrelationId: "123e4567-e89b-12d3-a456-426614174000",
  resolved: {
    sbi: "106284736",
    frn: "1101234567",
    originalInvoiceNumber: "ORIG-INV-123",
    scheme: "SFI",
    sourceSystem: "FPTT",
    deliveryBody: "RP00",
    fesCode: "FALS_FPTT",
    ledger: "AP",
    totalAmountPence: 2000,
    currency: "GBP",
    marketingYear: "2026",
    duePayments: [
      {
        dueDate: "2026-11-06",
        totalAmountPence: 2000,
        invoiceLines: [
          {
            schemeCode: "CMOR1",
            description: "Large White Pig",
            amountPence: 2000,
            accountCode: "SOS710",
            fundCode: "DRD10",
          },
        ],
      },
    ],
  },
};

const session = {};

describe("createAgreementPaymentUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allocateNextSequence.mockResolvedValue(7);
  });

  it("allocates the claim ID and inserts the Payment on the caller's session", async () => {
    const { payment } = await createAgreementPaymentUseCase(request, session);

    expect(allocateNextSequence).toHaveBeenCalledWith("claimIds", session);
    expect(insertPayment).toHaveBeenCalledWith(payment, session);
    expect(payment).toMatchObject({
      source: {
        type: "agreement",
        agreementNumber: "PMF123456789",
        version: 2,
      },
      sbi: "106284736",
      frn: "1101234567",
      paymentHubClaimId: "R00000007",
      invoiceNumber: "R00000007-V001QX",
      originalInvoiceNumber: "ORIG-INV-123",
      totalAmountPence: 2000,
    });
  });

  it("returns the Payment Service publication for the caller to commit", async () => {
    const { payment, publication } = await createAgreementPaymentUseCase(
      request,
      session,
    );

    expect(publication).toMatchObject({
      target:
        "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_payment_fifo.fifo",
      segregationRef: "PMF123456789",
      event: {
        type: "io.onsite.agreement.create-payment",
        source: "urn:service:agreement",
        data: {
          claimId: payment.paymentHubClaimId,
          grants: [
            {
              agreementNumber: "PMF123456789",
              totalAmountPence: "2000",
            },
          ],
        },
      },
    });
    expect(publication.event).not.toHaveProperty("messageGroupId");
  });
});
