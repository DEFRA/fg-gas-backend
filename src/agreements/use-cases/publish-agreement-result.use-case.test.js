import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { Outbox } from "../../grants/models/outbox.js";
import {
  existsByEventId,
  insertMany,
} from "../../grants/repositories/outbox.repository.js";
import { Agreement } from "../models/agreement.js";
import {
  publishAgreementPublication,
  publishAgreementResult,
} from "./publish-agreement-result.use-case.js";

vi.mock("../../grants/repositories/outbox.repository.js");

const createLifecycleChange = () => {
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
      type: "created",
      changedBy: "system",
      fromStatus: null,
    },
    findItemState: vi.fn().mockReturnValue({
      status: "offered",
      payment: null,
    }),
  };

  return { agreement, item, version };
};

describe("publish Agreement publication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsByEventId.mockResolvedValue(false);
  });

  it("publishes the Agreement lifecycle event for a publication", async () => {
    const lifecycleChange = createLifecycleChange();

    await publishAgreementPublication(
      {
        ...lifecycleChange,
        publication: {
          lifecycleEvent: true,
        },
      },
      "session",
    );

    expect(insertMany).toHaveBeenCalledWith([expect.any(Outbox)], "session");

    const outbox = insertMany.mock.calls[0][0][0];
    expect(outbox.target).toBe(config.sns.agreementStatusUpdatedTopicArn);
    expect(outbox.event.type).toBe(
      "cloud.defra.local.fg-gas-backend.agreement.created",
    );
    expect(outbox.event.source).toBe("AS");
    expect(lifecycleChange.version.findItemState).toHaveBeenCalledWith(
      "agreement-item-id",
    );
    expect(outbox.event.data).toEqual({
      eventId: "version-id",
      agreementId: "agreement-id",
      agreementVersionId: "version-id",
      agreementItemId: "agreement-item-id",
      agreementNumber: "PMF123456789",
      agreementCode: "pigs-might-fly",
      code: "pigs-might-fly",
      clientRef: "PMF-APP-001",
      changeType: "created",
      changedAt: "2026-06-01T10:00:00.000Z",
      changedBy: "system",
      fromStatus: null,
      toStatus: "offered",
      status: "offered",
      date: "2026-06-01T10:00:00.000Z",
      startDate: undefined,
      endDate: undefined,
      claimId: undefined,
    });
  });

  it("does not duplicate an Agreement lifecycle event already in the outbox", async () => {
    const lifecycleChange = createLifecycleChange();
    existsByEventId.mockResolvedValue(true);

    await publishAgreementPublication(
      {
        ...lifecycleChange,
        publication: {
          lifecycleEvent: true,
        },
      },
      "session",
    );

    expect(existsByEventId).toHaveBeenCalledWith("version-id", "session");
    expect(insertMany).not.toHaveBeenCalled();
  });
});

describe("publish Agreement publication with payment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsByEventId.mockResolvedValue(false);
  });

  it("publishes payment and lifecycle outbox records from one Publication concern", async () => {
    const baseChange = createLifecycleChange();

    const lifecycleChange = {
      ...baseChange,
      publication: {
        lifecycleEvent: true,
        paymentClaim: {
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
        },
      },
      version: {
        ...baseChange.version,
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
      },
    };

    await publishAgreementPublication(lifecycleChange, "session");

    expect(insertMany).toHaveBeenCalledWith(
      [expect.any(Outbox), expect.any(Outbox)],
      "session",
    );

    const [paymentOutbox, lifecycleOutbox] = insertMany.mock.calls[0][0];
    expect(paymentOutbox.target).toBe(config.sns.createPaymentTopicArn);
    expect(paymentOutbox.event.type).toBe(config.sns.createPaymentType);
    expect(lifecycleOutbox.target).toBe(
      config.sns.agreementStatusUpdatedTopicArn,
    );
    expect(lifecycleOutbox.event.type).toBe(
      "cloud.defra.local.fg-gas-backend.agreement.accepted",
    );
  });
});

describe("publish Agreement result", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsByEventId.mockResolvedValue(false);
  });

  it("publishes lifecycle output for a created Agreement result", async () => {
    const lifecycleChange = createLifecycleChange();

    await publishAgreementResult(
      {
        ...lifecycleChange,
        publication: {
          lifecycleEvent: true,
        },
      },
      "session",
    );

    expect(insertMany).toHaveBeenCalledWith([expect.any(Outbox)], "session");
  });

  it("does not publish for an idempotent Agreement creation result", async () => {
    await publishAgreementResult(
      {
        agreementId: "agreement-id",
        publication: {},
        sbi: "123456789",
      },
      "session",
    );

    expect(insertMany).not.toHaveBeenCalled();
  });

  it("does not publish for an Agreement action result without a new version", async () => {
    const lifecycleChange = createLifecycleChange();

    await publishAgreementResult(
      {
        agreement: lifecycleChange.agreement,
        item: lifecycleChange.item,
        publication: {
          lifecycleEvent: true,
        },
        status: "accepted",
      },
      "session",
    );

    expect(insertMany).not.toHaveBeenCalled();
  });

  it("publishes lifecycle output for an Agreement action result", async () => {
    const lifecycleChange = createLifecycleChange();

    await publishAgreementResult(
      {
        ...lifecycleChange,
        publication: {
          lifecycleEvent: true,
        },
        status: "accepted",
      },
      "session",
    );

    expect(insertMany).toHaveBeenCalledWith([expect.any(Outbox)], "session");
  });
});
