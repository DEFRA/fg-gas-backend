import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { acceptAgreementItem } from "./accept-agreement-item.use-case.js";

vi.mock("../../common/mongo-client.js");

describe("accept Agreement item use case", () => {
  const agreementDocument = {
    _id: "agreement-id",
    agreementNumber: "PMF000000001",
    sbi: "123456789",
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    items: [
      {
        agreementItemId: "agreement-item-id",
        agreementCode: "pigs-might-fly",
        clientRef: "PMF-APP-001",
      },
    ],
  };

  const versionDocument = {
    _id: "version-1",
    agreementId: "agreement-id",
    agreementNumber: "PMF000000001",
    sbi: "123456789",
    version: 1,
    createdAt: "2026-06-01T09:00:00.000Z",
    change: {
      type: "created",
      changedBy: "system",
      fromStatus: null,
    },
    snapshot: {
      ...agreementDocument,
      items: [
        {
          ...agreementDocument.items[0],
          status: "offered",
          payment: null,
        },
      ],
    },
  };

  const useCollections = ({ agreements, agreementVersions, outbox }) =>
    db.collection.mockImplementation((name) => {
      if (name === "agreement_versions") {
        return agreementVersions;
      }

      if (name === "outbox") {
        return outbox;
      }

      return agreements;
    });

  it("moves an offered Agreement item to acceptancePending and queues payment processing", async () => {
    const agreements = {
      findOne: vi.fn().mockResolvedValue(agreementDocument),
    };
    const agreementVersions = {
      findOne: vi.fn().mockResolvedValue(versionDocument),
      insertOne: vi.fn(),
    };
    const outbox = {
      insertMany: vi.fn(),
    };
    useCollections({ agreements, agreementVersions, outbox });

    const result = await acceptAgreementItem(
      {
        agreementItemId: "agreement-item-id",
        actionName: "acceptAgreementItem",
        acceptedBy: "applicant",
      },
      "session",
      {
        createId: () => "version-2",
        now: () => "2026-06-01T10:00:00.000Z",
      },
    );

    expect(result.status).toBe("acceptancePending");
    expect(agreementVersions.insertOne).toHaveBeenCalledWith(
      {
        ...versionDocument,
        _id: "version-2",
        version: 2,
        createdAt: "2026-06-01T10:00:00.000Z",
        change: {
          type: "acceptancePending",
          changedBy: "applicant",
          fromStatus: "offered",
        },
        snapshot: {
          ...versionDocument.snapshot,
          updatedAt: "2026-06-01T10:00:00.000Z",
          items: [
            {
              ...versionDocument.snapshot.items[0],
              status: "acceptancePending",
              acceptedAt: "2026-06-01T10:00:00.000Z",
              acceptedBy: "applicant",
            },
          ],
        },
      },
      { session: "session" },
    );
    expect(outbox.insertMany).toHaveBeenCalledWith(
      [expect.objectContaining({ event: expect.any(Object) })],
      { session: "session" },
    );

    const [paymentOutbox] = outbox.insertMany.mock.calls[0][0];
    expect(paymentOutbox.event.type).toBe(
      "cloud.defra.local.fg-gas-backend.agreement.payment.create",
    );
    expect(paymentOutbox.event.data).toEqual({
      agreementId: "agreement-id",
      agreementItemId: "agreement-item-id",
      agreementNumber: "PMF000000001",
      code: "pigs-might-fly",
      clientRef: "PMF-APP-001",
      acceptanceVersionId: "version-2",
    });
  });
});
