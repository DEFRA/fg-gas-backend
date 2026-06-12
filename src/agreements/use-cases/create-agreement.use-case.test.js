import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import {
  agreementCreationOutcomes,
  createAgreement,
} from "./create-agreement.use-case.js";

vi.mock("../../common/mongo-client.js");

describe("create agreement use case", () => {
  const command = {
    clientRef: "PMF-APP-001",
    code: "pigs-might-fly",
    identifiers: { sbi: "123456789", frn: "frn-1" },
    metadata: { defraId: "defra-id-1" },
    answers: { canPigsFly: true },
  };

  const useCollections = ({ agreements, agreementVersions }) =>
    db.collection.mockImplementation((name) => {
      if (name === "agreement_versions") {
        return agreementVersions;
      }

      return agreements;
    });

  it("creates one Agreement wrapper and version 1 for a new source agreement", async () => {
    const agreements = {
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: "agreement-id" }),
    };
    const agreementVersions = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: "version-id" }),
    };
    useCollections({ agreements, agreementVersions });

    const result = await createAgreement(command, "session", {
      createId: vi
        .fn()
        .mockReturnValueOnce("agreement-id")
        .mockReturnValueOnce("agreement-item-id")
        .mockReturnValueOnce("version-id"),
      generateAgreementNumber: () => "PMF000000001",
      now: () => "2026-06-01T10:00:00.000Z",
    });

    expect(result.outcome).toBe(agreementCreationOutcomes.CREATED);
    expect(result.agreementId).toBe("agreement-id");
    expect(result.agreementNumber).toBe("PMF000000001");
    expect(result.sbi).toBe("123456789");
    expect(result.item.agreementItemId).toBe("agreement-item-id");
    expect(result.version.id).toBe("version-id");
    expect(agreements.insertOne).toHaveBeenCalledWith(
      {
        _id: "agreement-id",
        agreementNumber: "PMF000000001",
        sbi: "123456789",
        createdAt: "2026-06-01T10:00:00.000Z",
        updatedAt: "2026-06-01T10:00:00.000Z",
        items: [
          {
            agreementItemId: "agreement-item-id",
            agreementCode: "pigs-might-fly",
            clientRef: "PMF-APP-001",
            configVersion: "0.0.1",
            identifiers: {
              frn: "frn-1",
              crn: undefined,
              defraId: "defra-id-1",
            },
            payload: {
              clientRef: "PMF-APP-001",
              code: "pigs-might-fly",
              identifiers: { sbi: "123456789", frn: "frn-1" },
              metadata: { defraId: "defra-id-1" },
              answers: { canPigsFly: true },
            },
            createdAt: "2026-06-01T10:00:00.000Z",
          },
        ],
      },
      { session: "session" },
    );
    expect(agreementVersions.insertOne).toHaveBeenCalledWith(
      {
        _id: "version-id",
        agreementId: "agreement-id",
        agreementNumber: "PMF000000001",
        sbi: "123456789",
        version: 1,
        createdAt: "2026-06-01T10:00:00.000Z",
        change: {
          type: "created",
          changedBy: "system",
          fromStatus: null,
        },
        snapshot: {
          _id: "agreement-id",
          agreementNumber: "PMF000000001",
          sbi: "123456789",
          createdAt: "2026-06-01T10:00:00.000Z",
          updatedAt: "2026-06-01T10:00:00.000Z",
          items: [
            {
              agreementItemId: "agreement-item-id",
              agreementCode: "pigs-might-fly",
              clientRef: "PMF-APP-001",
              configVersion: "0.0.1",
              identifiers: {
                frn: "frn-1",
                crn: undefined,
                defraId: "defra-id-1",
              },
              payload: {
                clientRef: "PMF-APP-001",
                code: "pigs-might-fly",
                identifiers: { sbi: "123456789", frn: "frn-1" },
                metadata: { defraId: "defra-id-1" },
                answers: { canPigsFly: true },
              },
              createdAt: "2026-06-01T10:00:00.000Z",
              status: "offered",
              payment: null,
            },
          ],
        },
      },
      { session: "session" },
    );
  });

  it("returns the existing Agreement item for an idempotent source command", async () => {
    const existing = {
      _id: "existing-agreement-id",
      agreementNumber: "PMF000000001",
      sbi: "987654321",
      items: [
        {
          agreementItemId: "agreement-item-id",
          agreementCode: "pigs-might-fly",
          clientRef: "PMF-APP-001",
        },
      ],
    };
    const agreements = {
      findOne: vi.fn().mockResolvedValue(existing),
      insertOne: vi.fn(),
      updateOne: vi.fn(),
    };
    const agreementVersions = {
      insertOne: vi.fn(),
    };
    useCollections({ agreements, agreementVersions });

    const result = await createAgreement(command, "session");

    expect(result.outcome).toBe(agreementCreationOutcomes.ALREADY_CREATED);
    expect(result.agreementId).toBe("existing-agreement-id");
    expect(result.agreementNumber).toBe("PMF000000001");
    expect(result.sbi).toBe("987654321");
    expect(result.item.toDocument()).toEqual(existing.items[0]);
    expect(result.version).toBeUndefined();
    expect(agreements.findOne).toHaveBeenCalledWith(
      {
        items: {
          $elemMatch: {
            agreementCode: "pigs-might-fly",
            clientRef: "PMF-APP-001",
          },
        },
      },
      { session: "session" },
    );
    expect(agreements.insertOne).not.toHaveBeenCalled();
    expect(agreements.updateOne).not.toHaveBeenCalled();
    expect(agreementVersions.insertOne).not.toHaveBeenCalled();
  });

  it("creates a separate Agreement wrapper for a different source on the same SBI", async () => {
    const agreements = {
      findOne: vi.fn().mockResolvedValueOnce(null),
      insertOne: vi.fn(),
    };
    const agreementVersions = {
      insertOne: vi.fn(),
    };
    useCollections({ agreements, agreementVersions });

    const result = await createAgreement(command, "session", {
      createId: vi
        .fn()
        .mockReturnValueOnce("new-agreement-id")
        .mockReturnValueOnce("agreement-item-id")
        .mockReturnValueOnce("version-id"),
      generateAgreementNumber: () => "PMF000000002",
      now: () => "2026-06-01T10:00:00.000Z",
    });

    expect(result.outcome).toBe(agreementCreationOutcomes.CREATED);
    expect(result.agreementId).toBe("new-agreement-id");
    expect(result.agreementNumber).toBe("PMF000000002");
    expect(agreements.findOne).toHaveBeenCalledTimes(1);
    expect(agreements.findOne).not.toHaveBeenCalledWith(
      { sbi: "123456789" },
      expect.anything(),
    );
    expect(agreements.insertOne).toHaveBeenCalledWith(
      {
        _id: "new-agreement-id",
        agreementNumber: "PMF000000002",
        sbi: "123456789",
        createdAt: "2026-06-01T10:00:00.000Z",
        updatedAt: "2026-06-01T10:00:00.000Z",
        items: [result.item.toDocument()],
      },
      { session: "session" },
    );
  });

  it("retries with a new Agreement number when wrapper insert hits a duplicate key", async () => {
    const duplicateKey = new Error("duplicate key");
    duplicateKey.code = 11000;
    duplicateKey.keyPattern = { agreementNumber: 1 };

    const agreements = {
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi
        .fn()
        .mockRejectedValueOnce(duplicateKey)
        .mockResolvedValueOnce({ insertedId: "agreement-id-2" }),
    };
    const agreementVersions = {
      insertOne: vi.fn(),
    };
    useCollections({ agreements, agreementVersions });

    const result = await createAgreement(command, "session", {
      createId: vi
        .fn()
        .mockReturnValueOnce("agreement-id")
        .mockReturnValueOnce("agreement-item-id")
        .mockReturnValueOnce("version-id")
        .mockReturnValueOnce("agreement-id-2")
        .mockReturnValueOnce("agreement-item-id-2")
        .mockReturnValueOnce("version-id-2"),
      generateAgreementNumber: vi
        .fn()
        .mockReturnValueOnce("PMF000000001")
        .mockReturnValueOnce("PMF000000002"),
      now: () => "2026-06-01T10:00:00.000Z",
    });

    expect(result.outcome).toBe(agreementCreationOutcomes.CREATED);
    expect(agreements.insertOne).toHaveBeenCalledTimes(2);
    expect(agreements.insertOne.mock.calls[0][0].agreementNumber).toBe(
      "PMF000000001",
    );
    expect(agreements.insertOne.mock.calls[1][0].agreementNumber).toBe(
      "PMF000000002",
    );
    expect(result.agreementNumber).toBe("PMF000000002");
    expect(result.item.toDocument()).not.toHaveProperty("agreementNumber");
    expect(result.version.id).toBe("version-id-2");
    expect(agreementVersions.insertOne).toHaveBeenCalledTimes(1);
  });

  it("returns the existing Agreement when a concurrent create hits the source identity index", async () => {
    const duplicateKey = new Error("duplicate key");
    duplicateKey.code = 11000;
    duplicateKey.keyPattern = {
      "items.clientRef": 1,
      "items.agreementCode": 1,
    };
    const existing = {
      _id: "existing-agreement-id",
      agreementNumber: "PMF000000001",
      sbi: "123456789",
      items: [
        {
          agreementItemId: "existing-agreement-item-id",
          agreementCode: "pigs-might-fly",
          clientRef: "PMF-APP-001",
        },
      ],
    };

    const agreements = {
      findOne: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existing),
      insertOne: vi.fn().mockRejectedValueOnce(duplicateKey),
    };
    const agreementVersions = {
      insertOne: vi.fn(),
    };
    useCollections({ agreements, agreementVersions });

    const result = await createAgreement(command, "session", {
      createId: vi
        .fn()
        .mockReturnValueOnce("agreement-id")
        .mockReturnValueOnce("agreement-item-id")
        .mockReturnValueOnce("version-id"),
      generateAgreementNumber: () => "PMF000000001",
      now: () => "2026-06-01T10:00:00.000Z",
    });

    expect(result.outcome).toBe(agreementCreationOutcomes.ALREADY_CREATED);
    expect(result.agreementId).toBe("existing-agreement-id");
    expect(result.item.agreementItemId).toBe("existing-agreement-item-id");
    expect(agreements.insertOne).toHaveBeenCalledTimes(1);
    expect(agreementVersions.insertOne).not.toHaveBeenCalled();
  });

  it("does not retry duplicate key errors from unknown indexes", async () => {
    const duplicateKey = new Error("duplicate key");
    duplicateKey.code = 11000;
    duplicateKey.keyPattern = {
      "items.agreementItemId": 1,
    };

    const agreements = {
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockRejectedValueOnce(duplicateKey),
    };
    const agreementVersions = {
      insertOne: vi.fn(),
    };
    useCollections({ agreements, agreementVersions });

    await expect(
      createAgreement(command, "session", {
        createId: vi
          .fn()
          .mockReturnValueOnce("agreement-id")
          .mockReturnValueOnce("agreement-item-id")
          .mockReturnValueOnce("version-id"),
        generateAgreementNumber: () => "PMF000000001",
        now: () => "2026-06-01T10:00:00.000Z",
      }),
    ).rejects.toBe(duplicateKey);

    expect(agreements.insertOne).toHaveBeenCalledTimes(1);
    expect(agreementVersions.insertOne).not.toHaveBeenCalled();
  });
});
