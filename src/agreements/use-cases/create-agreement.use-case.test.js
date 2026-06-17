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
    identifiers: { sbi: "123456789", frn: "frn-1", crn: "crn-1" },
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
      callEndpoint: vi.fn().mockResolvedValue(undefined),
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
        code: "pigs-might-fly",
        identifiers: {
          sbi: "123456789",
          frn: "frn-1",
          crn: "crn-1",
        },
        createdAt: "2026-06-01T10:00:00.000Z",
        updatedAt: "2026-06-01T10:00:00.000Z",
        items: [
          {
            agreementItemId: "agreement-item-id",
            clientRef: "PMF-APP-001",
            configVersion: "0.0.1",
            identifiers: {
              sbi: "123456789",
              frn: "frn-1",
              crn: "crn-1",
              defraId: "defra-id-1",
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
        version: 1,
        createdAt: "2026-06-01T10:00:00.000Z",
        snapshot: {
          _id: "agreement-id",
          agreementNumber: "PMF000000001",
          code: "pigs-might-fly",
          identifiers: {
            sbi: "123456789",
            frn: "frn-1",
            crn: "crn-1",
          },
          createdAt: "2026-06-01T10:00:00.000Z",
          updatedAt: "2026-06-01T10:00:00.000Z",
          items: [
            {
              agreementItemId: "agreement-item-id",
              clientRef: "PMF-APP-001",
              configVersion: "0.0.1",
              identifiers: {
                sbi: "123456789",
                frn: "frn-1",
                crn: "crn-1",
                defraId: "defra-id-1",
              },
              payload: {
                clientRef: "PMF-APP-001",
                code: "pigs-might-fly",
                identifiers: { sbi: "123456789", frn: "frn-1", crn: "crn-1" },
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

  it("calls the configured endpoint and stores the raw response during Agreement creation", async () => {
    const agreements = {
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: "agreement-id" }),
    };
    const agreementVersions = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: "version-id" }),
    };
    const callEndpoint = vi.fn().mockResolvedValue({
      grandTotal: 1325,
      items: [
        {
          description: "Large White Pig",
          quantity: 25,
          total: 250,
          type: "largeWhite",
          value: 10,
        },
        {
          description: "British Landrace",
          quantity: 25,
          total: 375,
          type: "britishLandrace",
          value: 15,
        },
        {
          description: "Berkshire",
          quantity: 25,
          total: 450,
          type: "berkshire",
          value: 18,
        },
        {
          description: "Other",
          quantity: 25,
          total: 250,
          type: "other",
          value: 10,
        },
      ],
    });
    useCollections({ agreements, agreementVersions });

    await createAgreement(
      {
        ...command,
        answers: {
          isPigFarmer: true,
          totalPigs: 100,
          whitePigsCount: 25,
          britishLandracePigsCount: 25,
          berkshirePigsCount: 25,
          otherPigsCount: 25,
        },
      },
      "session",
      {
        callEndpoint,
        createId: vi
          .fn()
          .mockReturnValueOnce("agreement-id")
          .mockReturnValueOnce("agreement-item-id")
          .mockReturnValueOnce("version-id"),
        generateAgreementNumber: () => "PMF000000001",
        now: () => "2026-06-01T10:00:00.000Z",
      },
    );

    expect(callEndpoint).toHaveBeenCalledWith({
      endpoint: expect.objectContaining({
        code: "calculate-funding",
        method: "POST",
        path: "/grantFundingCalculator",
        service: "GRANT_FUNDING_CALCULATOR",
      }),
      params: {
        BODY: {
          pigTypes: [
            { pigType: "largeWhite", quantity: 25 },
            { pigType: "britishLandrace", quantity: 25 },
            { pigType: "berkshire", quantity: 25 },
            { pigType: "other", quantity: 25 },
          ],
        },
      },
    });
    expect(agreements.insertOne.mock.calls[0][0].items[0]).not.toHaveProperty(
      "payload",
    );
    expect(
      agreementVersions.insertOne.mock.calls[0][0].snapshot.items[0].payload
        .answers.fundingCalculation,
    ).toBeUndefined();
    expect(
      agreementVersions.insertOne.mock.calls[0][0].snapshot.items[0]
        .fundingCalculation,
    ).toMatchObject({
      grandTotal: 1325,
      items: expect.arrayContaining([
        {
          description: "Large White Pig",
          quantity: 25,
          total: 250,
          type: "largeWhite",
          value: 10,
        },
      ]),
    });
  });

  it("defaults omitted PMF pig counts to zero for funding calculation", async () => {
    const agreements = {
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: "agreement-id" }),
    };
    const agreementVersions = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: "version-id" }),
    };
    const callEndpoint = vi.fn().mockResolvedValue({
      grandTotal: 100,
      items: [
        {
          description: "Large White Pig",
          quantity: 10,
          total: 100,
          type: "largeWhite",
          value: 10,
        },
      ],
    });
    useCollections({ agreements, agreementVersions });

    await createAgreement(
      {
        ...command,
        answers: {
          isPigFarmer: true,
          totalPigs: 10,
          whitePigsCount: 10,
        },
      },
      "session",
      {
        callEndpoint,
        createId: vi
          .fn()
          .mockReturnValueOnce("agreement-id")
          .mockReturnValueOnce("agreement-item-id")
          .mockReturnValueOnce("version-id"),
        generateAgreementNumber: () => "PMF000000001",
        now: () => "2026-06-01T10:00:00.000Z",
      },
    );

    expect(callEndpoint).toHaveBeenCalledWith({
      endpoint: expect.objectContaining({
        code: "calculate-funding",
      }),
      params: {
        BODY: {
          pigTypes: [
            { pigType: "largeWhite", quantity: 10 },
            { pigType: "britishLandrace", quantity: 0 },
            { pigType: "berkshire", quantity: 0 },
            { pigType: "other", quantity: 0 },
          ],
        },
      },
    });
  });

  it("stores configured endpoint responses without transforming them during Agreement creation", async () => {
    const agreements = {
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: "agreement-id" }),
    };
    const agreementVersions = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: "version-id" }),
    };
    useCollections({ agreements, agreementVersions });

    await createAgreement(
      {
        ...command,
        answers: {
          largeAnimalsCount: 2,
          smallAnimalsCount: 3,
        },
      },
      "session",
      {
        callEndpoint: vi.fn().mockResolvedValue({
          calculated: {
            grantTotal: 42,
            lines: [
              {
                amount: 10,
                label: "Large animal",
                schemeCode: "LARGE",
              },
              {
                amount: 32,
                label: "Small animal",
                schemeCode: "SMALL",
              },
            ],
          },
        }),
        createId: vi
          .fn()
          .mockReturnValueOnce("agreement-id")
          .mockReturnValueOnce("agreement-item-id")
          .mockReturnValueOnce("version-id"),
        generateAgreementNumber: () => "CFG000000001",
        getAgreementCreation: () => ({
          agreementCode: "configurable-grant",
          agreementNumberPrefix: "CFG",
          configVersion: "0.0.1",
          initialStatus: "offered",
          create: {
            target: "offered",
            effects: [
              {
                name: "callEndpoint",
                output: "fundingCalculation",
                params: {
                  endpoint: {
                    code: "calculate-configurable-payment",
                    endpointParams: {
                      BODY: 'jsonata:{"animalCounts": [$.answers.largeAnimalsCount, $.answers.smallAnimalsCount]}',
                    },
                  },
                },
              },
              {
                name: "snapshot",
                params: {
                  fundingCalculation: "$.outputs.fundingCalculation",
                },
              },
            ],
          },
        }),
        now: () => "2026-06-01T10:00:00.000Z",
      },
    );

    expect(agreements.insertOne.mock.calls[0][0].items[0]).not.toHaveProperty(
      "payload",
    );
    expect(
      agreementVersions.insertOne.mock.calls[0][0].snapshot.items[0].payload
        .answers.fundingCalculation,
    ).toBeUndefined();
    expect(
      agreementVersions.insertOne.mock.calls[0][0].snapshot.items[0]
        .fundingCalculation,
    ).toEqual({
      calculated: {
        grantTotal: 42,
        lines: [
          {
            amount: 10,
            label: "Large animal",
            schemeCode: "LARGE",
          },
          {
            amount: 32,
            label: "Small animal",
            schemeCode: "SMALL",
          },
        ],
      },
    });
  });

  it("returns the existing Agreement item for an idempotent source command", async () => {
    const existing = {
      _id: "existing-agreement-id",
      agreementNumber: "PMF000000001",
      code: "pigs-might-fly",
      sbi: "987654321",
      items: [
        {
          agreementItemId: "agreement-item-id",
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
        "items.clientRef": "PMF-APP-001",
        $or: [
          { code: "pigs-might-fly" },
          { "items.agreementCode": "pigs-might-fly" },
        ],
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
      callEndpoint: vi.fn().mockResolvedValue(undefined),
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
        code: "pigs-might-fly",
        identifiers: {
          sbi: "123456789",
          frn: "frn-1",
          crn: "crn-1",
        },
        createdAt: "2026-06-01T10:00:00.000Z",
        updatedAt: "2026-06-01T10:00:00.000Z",
        items: [result.item.toDocument()],
      },
      { session: "session" },
    );
  });

  it("does not store payment claim fields during Agreement creation", async () => {
    const agreements = {
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: "agreement-id" }),
    };
    const agreementVersions = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: "version-id" }),
    };
    useCollections({ agreements, agreementVersions });

    const result = await createAgreement(
      {
        ...command,
        code: "woodland",
      },
      "session",
      {
        createId: vi
          .fn()
          .mockReturnValueOnce("agreement-id")
          .mockReturnValueOnce("agreement-item-id")
          .mockReturnValueOnce("version-id"),
        generateAgreementNumber: () => "WMP000000001",
        getAgreementCreation: () => ({
          agreementCode: "woodland",
          agreementNumberPrefix: "WMP",
          configVersion: "0.0.1",
          initialStatus: "offered",
        }),
        now: () => "2026-06-01T10:00:00.000Z",
      },
    );

    expect(result.outcome).toBe(agreementCreationOutcomes.CREATED);
    expect(result.item.toDocument()).not.toHaveProperty("claimId");
    expect(result.item.toDocument()).not.toHaveProperty(
      "originalInvoiceNumber",
    );
    expect(result.item.payload).not.toHaveProperty("claimId");
    expect(result.item.payload).not.toHaveProperty("originalInvoiceNumber");
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
      callEndpoint: vi.fn().mockResolvedValue(undefined),
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
      code: 1,
      "items.clientRef": 1,
    };
    const existing = {
      _id: "existing-agreement-id",
      agreementNumber: "PMF000000001",
      code: "pigs-might-fly",
      sbi: "123456789",
      items: [
        {
          agreementItemId: "existing-agreement-item-id",
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
      callEndpoint: vi.fn().mockResolvedValue(undefined),
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
        callEndpoint: vi.fn().mockResolvedValue(undefined),
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
