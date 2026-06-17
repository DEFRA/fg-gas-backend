import { describe, expect, it } from "vitest";
import { config } from "../../common/config.js";
import { CreatePaymentClaimCommand } from "./create-payment-claim.command.js";

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
      descriptionTemplate: "{paymentDate}: {item.description}",
      idField: "landItemId",
      itemsPath: "landItems",
      schemeCodePath: "item.code",
    },
  ],
  marketingYear: "2027",
  paymentRequestNumber: 7,
  scheme: "ALT",
  sourceSystem: "CUSTOM",
};

const createProcessablePayment = () => ({
  agreementTotalPence: 7000,
  landItems: {
    "land-line": {
      code: "LND1",
      description: "land item",
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
      ],
      paymentDate: "2027-02-01",
      totalPaymentPence: 7000,
    },
  ],
});

describe("CreatePaymentClaimCommand", () => {
  it("wraps payment claim payload in a CloudEvent-compatible command", () => {
    const command = new CreatePaymentClaimCommand({
      agreement: {
        agreementNumber: "ALT000000001",
        code: "alternative-grant",
        sbi: "123456789",
      },
      item: {
        agreementItemId: "agreement-item-id",
        clientRef: "ALT-APP-001",
        identifiers: {
          frn: "1100000012",
        },
      },
      paymentClaim,
      version: {
        createdAt: "2027-01-01T00:00:00.000Z",
        findItemState: () => ({
          claimId: "R00000001",
          correlationId: "agreement-correlation-id",
          originalInvoiceNumber: "ORIG-001",
          payment: createProcessablePayment(),
        }),
      },
    });

    expect(command).toMatchObject({
      datacontenttype: "application/json",
      messageGroupId: "ALT-APP-001-alternative-grant",
      source: config.serviceName,
      specversion: "1.0",
      type: config.sns.createPaymentType,
    });
    expect(command.id).toEqual(expect.any(String));
    expect(command.time).toEqual(expect.any(String));
    expect(command.data).toMatchObject({
      claimId: "R00000001",
      frn: "1100000012",
      grants: [
        {
          agreementNumber: "ALT000000001",
          invoiceNumber: "R00000001-P007Z9",
          marketingYear: "2027",
        },
      ],
      sbi: "123456789",
      scheme: "ALT",
    });
  });
});
