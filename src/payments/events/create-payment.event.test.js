import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// The fixture is the message payload produced by the legacy Agreements API's
// createGrantPaymentFromAgreement test, wrapped in the CloudEvent fields GAS
// must preserve. GAS adds messageGroupId for Agreement-level FIFO grouping.
import legacyCreatePaymentEvent from "../../../test/fixtures/legacy-create-payment-event.json";
import { Payment } from "../models/payment.js";
import { createPaymentPublication } from "./create-payment.event.js";

vi.mock("node:crypto", () => ({
  randomUUID: () => "9c3ff46a-6625-4ba7-81f5-58a7602f91ed",
}));

const eventTime = "2026-08-01T11:00:00.000Z";

const payment = new Payment({
  id: "d5b4a5f7-6ac0-4a55-9ee7-3f5b6c1f8a41",
  source: { type: "agreement", agreementNumber: "FPTT123456", version: 2 },
  sbi: "SBI123",
  frn: "FRN456",
  paymentHubClaimId: "R00000001",
  scheme: "SFI",
  sourceSystem: "FPTT",
  deliveryBody: "RP00",
  fesCode: "FALS_FPTT",
  paymentRequestNumber: 1,
  correlationId: "123e4567-e89b-12d3-a456-426614174000",
  invoiceNumber: "R00000001-V001Q2",
  originalInvoiceNumber: "ORIG-INV-123",
  ledger: "AP",
  totalAmountPence: 10000,
  currency: "GBP",
  marketingYear: "2026",
  payments: [
    {
      dueDate: "2024-05-01",
      totalAmountPence: 10000,
      status: "pending",
      correlationId: "324b1946-7c0f-4be0-8573-020e482c9a8d",
      invoiceLines: [
        {
          schemeCode: "CODE-P1",
          description: "2024-05-01: Parcel: P1: Parcel Item Description",
          amountPence: 6000,
          accountCode: "SOS710",
          fundCode: "DRD10",
          deliveryBody: "RP00",
          marketingYear: "2026",
        },
        {
          schemeCode: "CODE-A1",
          description:
            "2024-05-01: One-off payment per agreement per year for Agreement Level Description",
          amountPence: 4000,
          accountCode: "SOS710",
          fundCode: "DRD10",
          deliveryBody: "RP00",
          marketingYear: "2026",
        },
      ],
    },
  ],
  createdAt: "2026-08-01T10:00:00.000Z",
});

describe("createPaymentPublication", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(eventTime);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("matches the complete captured legacy Payment Service event", () => {
    const { event } = createPaymentPublication(payment);

    expect(event).toEqual({
      id: "9c3ff46a-6625-4ba7-81f5-58a7602f91ed",
      time: eventTime,
      ...legacyCreatePaymentEvent,
    });
  });

  it("preserves the legacy event type and source", () => {
    const { event } = createPaymentPublication(payment);

    expect(event.type).toBe("io.onsite.agreement.create-payment");
    expect(event.source).toBe("urn:service:agreement");
  });

  it("targets the Payment Service topic", () => {
    const { target } = createPaymentPublication(payment);

    expect(target).toBe(
      "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_payment_fifo.fifo",
    );
  });

  it("groups by Agreement Number in the outbox and on the message", () => {
    const { event, segregationRef } = createPaymentPublication(payment);

    expect(segregationRef).toBe("FPTT123456");
    expect(event.messageGroupId).toBe("FPTT123456");
  });

  it("stringifies pence at the boundary", () => {
    const { event } = createPaymentPublication(payment);
    const [grant] = event.data.grants;

    expect(grant.totalAmountPence).toBe("10000");
    expect(grant.payments[0].totalAmountPence).toBe("10000");
    expect(grant.payments[0].invoiceLines[0].amountPence).toBe("6000");
    // The Payment itself is untouched.
    expect(payment.totalAmountPence).toBe(10000);
  });

  it("includes the accounting fields required by Payment Service", () => {
    const { event } = createPaymentPublication(payment);
    const [grant] = event.data.grants;

    expect(grant).toMatchObject({
      fesCode: "FALS_FPTT",
      ledger: "AP",
    });
    expect(grant.payments[0].invoiceLines[0]).toMatchObject({
      accountCode: "SOS710",
      fundCode: "DRD10",
      deliveryBody: "RP00",
      marketingYear: "2026",
    });
  });

  it("builds one grant per Payment", () => {
    const { event } = createPaymentPublication(payment);

    expect(event.data.grants).toHaveLength(1);
  });
});
