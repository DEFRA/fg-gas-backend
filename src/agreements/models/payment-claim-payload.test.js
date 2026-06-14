import { describe, expect, it } from "vitest";
import { createPaymentClaimPayload } from "./payment-claim-payload.js";

const paymentClaim = {
  defaultCurrency: "EUR",
  deliveryBody: "XX01",
  invoiceNumber: {
    requestPadding: 3,
    requestPrefix: "P",
    suffix: "Z9",
  },
  lineItemTypes: [
    {
      descriptionTemplate:
        "{paymentDate}: Custom parcel {item.parcelId} {item.description}",
      idField: "landItemId",
      itemsPath: "landItems",
      schemeCodePath: "item.code",
    },
    {
      descriptionTemplate:
        "{paymentDate}: Custom agreement item {item.description}",
      idField: "agreementItemId",
      itemsPath: "agreementItems",
      schemeCodePath: "item.code",
    },
  ],
  marketingYear: "2027",
  paymentRequestNumber: 7,
  scheme: "ALT",
  sourceSystem: "CUSTOM",
};

const createProcessablePayment = () => ({
  agreementTotalPence: 12000,
  agreementItems: {
    "agreement-line": {
      code: "AGR1",
      description: "capital item",
    },
  },
  landItems: {
    "land-line": {
      code: "LND1",
      description: "land item",
      parcelId: "AB1234",
    },
  },
  payments: [
    {
      correlationId: "payment-correlation-id",
      lineItems: [
        {
          landItemId: "land-line",
          paymentPence: 7000,
        },
        {
          agreementItemId: "agreement-line",
          paymentPence: 5000,
        },
      ],
      paymentDate: "2027-02-01",
      totalPaymentPence: 12000,
    },
  ],
});

const createPayload = (payment, overrides = {}) =>
  createPaymentClaimPayload({
    agreement: {
      agreementNumber: "ALT000000001",
      sbi: "123456789",
    },
    item: {
      agreementCode: "alternative-grant",
      agreementItemId: "agreement-item-id",
      clientRef: "ALT-APP-001",
      identifiers: {
        frn: "1100000012",
      },
    },
    itemState: {
      claimId: "R00000001",
      correlationId: "agreement-correlation-id",
      originalInvoiceNumber: "ORIG-001",
      payment,
    },
    paymentClaim: overrides.paymentClaim ?? paymentClaim,
    referenceDate: overrides.referenceDate ?? "2027-01-01T00:00:00.000Z",
  });

describe("createPaymentClaimPayload", () => {
  it("uses configured grant payment metadata and line item mappings", () => {
    expect(createPayload(createProcessablePayment())).toEqual({
      claimId: "R00000001",
      frn: "1100000012",
      grants: [
        {
          agreementNumber: "ALT000000001",
          correlationId: "agreement-correlation-id",
          currency: "EUR",
          deliveryBody: "XX01",
          invoiceNumber: "R00000001-P007Z9",
          marketingYear: "2027",
          originalInvoiceNumber: "ORIG-001",
          paymentRequestNumber: 7,
          payments: [
            {
              correlationId: "payment-correlation-id",
              dueDate: "2027-02-01",
              invoiceLines: [
                {
                  amountPence: "7000",
                  description: "2027-02-01: Custom parcel AB1234 land item",
                  schemeCode: "LND1",
                },
                {
                  amountPence: "5000",
                  description: "2027-02-01: Custom agreement item capital item",
                  schemeCode: "AGR1",
                },
              ],
              status: "pending",
              totalAmountPence: "12000",
            },
          ],
          sourceSystem: "CUSTOM",
          totalAmountPence: "12000",
        },
      ],
      sbi: "123456789",
      scheme: "ALT",
    });
  });

  it("resolves current marketing year from the reference date", () => {
    const payload = createPayload(createProcessablePayment(), {
      paymentClaim: {
        ...paymentClaim,
        marketingYear: "currentYear",
      },
      referenceDate: "2028-12-31T23:59:59.000Z",
    });

    expect(payload.grants[0].marketingYear).toBe("2028");
  });

  it("rejects payments without line item arrays", () => {
    const payment = createProcessablePayment();
    delete payment.payments[0].lineItems;

    expect(() => createPayload(payment)).toThrow(
      "Agreement payment is missing line items",
    );
  });

  it("rejects line items without configured payment item references", () => {
    const payment = createProcessablePayment();
    delete payment.landItems["land-line"];

    expect(() => createPayload(payment)).toThrow(
      "Agreement payment line item reference is missing",
    );
  });

  it("rejects line items without configured scheme codes", () => {
    const payment = createProcessablePayment();
    delete payment.landItems["land-line"].code;

    expect(() => createPayload(payment)).toThrow(
      "Agreement payment line item scheme code is missing",
    );
  });
});
