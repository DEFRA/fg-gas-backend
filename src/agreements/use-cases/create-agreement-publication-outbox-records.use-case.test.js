import { describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { Outbox } from "../../grants/models/outbox.js";
import { Agreement } from "../models/agreement.js";
import { createAgreementPublicationOutboxRecords } from "./create-agreement-publication-outbox-records.use-case.js";

const createPublicationChange = () => {
  const agreement = Agreement.fromDocument({
    _id: "agreement-id",
    agreementNumber: "PMF123456789",
    sbi: "123456789",
    items: [
      {
        agreementItemId: "agreement-item-id",
        agreementCode: "pigs-might-fly",
        clientRef: "PMF-APP-001",
        identifiers: {
          frn: "1100000012",
        },
      },
    ],
  });
  const item = agreement.items[0];
  const version = {
    id: "version-id",
    createdAt: "2026-06-01T10:00:00.000Z",
    change: {
      type: "accepted",
      changedBy: "applicant",
      fromStatus: "offered",
    },
    findItemState: vi.fn().mockReturnValue({
      claimId: "R00000001",
      correlationId: "agreement-correlation-id",
      originalInvoiceNumber: "",
      payment: {
        agreementLevelItems: {
          "agreement-level-item-id": {
            code: "UPL1",
            description: "upland offer",
          },
        },
        agreementStartDate: "2026-07-01",
        agreementEndDate: "2027-06-30",
        agreementTotalPence: 4000,
        payments: [
          {
            correlationId: "payment-correlation-id",
            lineItems: [
              {
                agreementLevelItemId: "agreement-level-item-id",
                paymentPence: 4000,
              },
            ],
            paymentDate: "2026-08-01",
            totalPaymentPence: 4000,
          },
        ],
      },
      status: "accepted",
    }),
  };

  return { agreement, item, version };
};

const paymentClaim = {
  defaultCurrency: "GBP",
  deliveryBody: "RP00",
  invoiceNumber: {
    requestPadding: 3,
    requestPrefix: "V",
    suffix: "QX",
  },
  lineItemTypes: [
    {
      descriptionTemplate: "{paymentDate}: {item.description}",
      idField: "agreementLevelItemId",
      itemsPath: "agreementLevelItems",
      schemeCodePath: "item.code",
    },
  ],
  marketingYear: "currentYear",
  paymentRequestNumber: 1,
  scheme: "SFI",
  sourceSystem: "FPTT",
};

describe("create Agreement publication outbox records", () => {
  it("creates a lifecycle outbox record from lifecycle publication intent", () => {
    const publicationChange = createPublicationChange();

    const records = createAgreementPublicationOutboxRecords({
      ...publicationChange,
      publication: {
        lifecycleEvent: true,
      },
    });

    expect(records).toEqual([expect.any(Outbox)]);
    expect(records[0].target).toBe(config.sns.agreementStatusUpdatedTopicArn);
    expect(records[0].event.type).toBe(
      "cloud.defra.local.fg-gas-backend.agreement.accepted",
    );
  });

  it("creates payment and lifecycle outbox records from one publication intent", () => {
    const publicationChange = createPublicationChange();

    const records = createAgreementPublicationOutboxRecords({
      ...publicationChange,
      publication: {
        lifecycleEvent: true,
        paymentClaim,
      },
    });

    expect(records).toEqual([expect.any(Outbox), expect.any(Outbox)]);
    expect(records[0].target).toBe(config.sns.createPaymentTopicArn);
    expect(records[0].event.type).toBe(config.sns.createPaymentType);
    expect(records[1].target).toBe(config.sns.agreementStatusUpdatedTopicArn);
    expect(records[1].event.type).toBe(
      "cloud.defra.local.fg-gas-backend.agreement.accepted",
    );
  });
});
