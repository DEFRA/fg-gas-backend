import { describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { db } from "../../common/mongo-client.js";
import { executeAgreementAction } from "./execute-agreement-action.use-case.js";

vi.mock("../../common/mongo-client.js");

describe("execute Agreement action use case", () => {
  const paymentSchedule = {
    agreementTotalPence: 10000,
    currency: "GBP",
    agreementStartDate: "2026-07-01",
    agreementEndDate: "2027-06-30",
    agreementLevelItems: {
      "agreement-level-item-id": {
        code: "UPL1",
        description: "upland offer",
      },
    },
    parcelItems: {
      "parcel-item-id": {
        code: "SOH1",
        description: "soil offer",
        parcelId: "AB1234",
      },
    },
    payments: [
      {
        paymentDate: "2026-08-01",
        totalPaymentPence: 10000,
        lineItems: [
          {
            agreementLevelItemId: "agreement-level-item-id",
            paymentPence: 4000,
          },
          {
            parcelItemId: "parcel-item-id",
            paymentPence: 6000,
          },
        ],
      },
    ],
  };

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
        identifiers: {
          frn: "1100000012",
        },
        payload: {
          answers: {
            payment: paymentSchedule,
          },
        },
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

  it("accepts an offered Agreement item and publishes a processable GPS payment request", async () => {
    const agreements = {
      findOne: vi.fn().mockResolvedValue(agreementDocument),
    };
    const agreementVersions = {
      findOne: vi.fn().mockResolvedValue(versionDocument),
      insertOne: vi.fn(),
    };
    const outbox = {
      findOne: vi.fn().mockResolvedValue(null),
      insertMany: vi.fn(),
    };
    const createCorrelationId = vi
      .fn()
      .mockReturnValueOnce("agreement-correlation-id")
      .mockReturnValueOnce("payment-correlation-id");
    useCollections({ agreements, agreementVersions, outbox });

    const result = await executeAgreementAction(
      {
        agreementNumber: "PMF000000001",
        actionName: "accept",
        payload: {
          code: "pigs-might-fly",
          clientRef: "PMF-APP-001",
          acceptedBy: "applicant",
        },
      },
      "session",
      {
        createCorrelationId,
        createId: () => "version-2",
        generateClaimId: () => "R00000001",
        now: () => "2026-06-01T10:00:00.000Z",
      },
    );

    expect(result.status).toBe("accepted");
    expect(agreements.findOne).toHaveBeenCalledWith(
      {
        agreementNumber: "PMF000000001",
        items: {
          $elemMatch: {
            agreementCode: "pigs-might-fly",
            clientRef: "PMF-APP-001",
          },
        },
      },
      { session: "session" },
    );
    expect(agreementVersions.insertOne).toHaveBeenCalledWith(
      {
        ...versionDocument,
        _id: "version-2",
        version: 2,
        createdAt: "2026-06-01T10:00:00.000Z",
        change: {
          type: "accepted",
          changedBy: "applicant",
          fromStatus: "offered",
        },
        snapshot: {
          ...versionDocument.snapshot,
          updatedAt: "2026-06-01T10:00:00.000Z",
          items: [
            {
              ...versionDocument.snapshot.items[0],
              status: "accepted",
              acceptedAt: "2026-06-01T10:00:00.000Z",
              acceptedBy: "applicant",
              claimId: "R00000001",
              correlationId: "agreement-correlation-id",
              originalInvoiceNumber: "",
              payment: {
                ...paymentSchedule,
                payments: [
                  {
                    ...paymentSchedule.payments[0],
                    correlationId: "payment-correlation-id",
                  },
                ],
              },
            },
          ],
        },
      },
      { session: "session" },
    );
    expect(outbox.insertMany).toHaveBeenCalledTimes(1);

    const [paymentOutbox] = outbox.insertMany.mock.calls[0][0];
    expect(paymentOutbox.target).toBe(config.sns.createPaymentTopicArn);
    expect(paymentOutbox.segregationRef).toBe("PMF-APP-001-pigs-might-fly");
    expect(paymentOutbox.event.type).toBe(config.sns.createPaymentType);
    expect(paymentOutbox.event.messageGroupId).toBe(
      "PMF-APP-001-pigs-might-fly",
    );
    expect(paymentOutbox.event.data).toEqual({
      claimId: "R00000001",
      frn: "1100000012",
      grants: [
        {
          agreementNumber: "PMF000000001",
          correlationId: "agreement-correlation-id",
          currency: "GBP",
          deliveryBody: "RP00",
          invoiceNumber: "R00000001-V001QX",
          marketingYear: "2026",
          originalInvoiceNumber: "",
          paymentRequestNumber: 1,
          payments: [
            {
              correlationId: "payment-correlation-id",
              dueDate: "2026-08-01",
              invoiceLines: [
                {
                  amountPence: "4000",
                  description:
                    "2026-08-01: One-off payment per agreement per year for upland offer",
                  schemeCode: "UPL1",
                },
                {
                  amountPence: "6000",
                  description: "2026-08-01: Parcel: AB1234: soil offer",
                  schemeCode: "SOH1",
                },
              ],
              status: "pending",
              totalAmountPence: "10000",
            },
          ],
          sourceSystem: "FPTT",
          totalAmountPence: "10000",
        },
      ],
      sbi: "123456789",
      scheme: "SFI",
    });

    const [, lifecycleOutbox] = outbox.insertMany.mock.calls[0][0];
    expect(lifecycleOutbox.event.type).toBe(
      "cloud.defra.local.fg-gas-backend.agreement.accepted",
    );
    expect(lifecycleOutbox.event.data).toMatchObject({
      eventId: "version-2",
      agreementItemId: "agreement-item-id",
      agreementNumber: "PMF000000001",
      code: "pigs-might-fly",
      clientRef: "PMF-APP-001",
      fromStatus: "offered",
      toStatus: "accepted",
      status: "accepted",
      claimId: "R00000001",
      startDate: "2026-07-01",
      endDate: "2027-06-30",
    });
  });

  it("uses the latest Agreement version as current state", async () => {
    const acceptedVersion = {
      ...versionDocument,
      _id: "version-2",
      version: 2,
      createdAt: "2026-06-01T10:00:00.000Z",
      change: {
        type: "accepted",
        changedBy: "applicant",
        fromStatus: "offered",
      },
      snapshot: {
        ...versionDocument.snapshot,
        updatedAt: "2026-06-01T10:00:00.000Z",
        items: [
          {
            ...versionDocument.snapshot.items[0],
            acceptedAt: "2026-06-01T10:00:00.000Z",
            acceptedBy: "applicant",
            claimId: "R00000001",
            correlationId: "agreement-correlation-id",
            originalInvoiceNumber: "",
            payment: paymentSchedule,
            status: "accepted",
          },
        ],
      },
    };
    const agreementWithStaleItemState = {
      ...agreementDocument,
      items: [
        {
          ...agreementDocument.items[0],
          status: "offered",
        },
      ],
    };
    const agreements = {
      findOne: vi.fn().mockResolvedValue(agreementWithStaleItemState),
    };
    const agreementVersions = {
      findOne: vi.fn().mockResolvedValue(acceptedVersion),
      insertOne: vi.fn(),
    };
    const outbox = {
      insertMany: vi.fn(),
    };
    const generateClaimId = vi.fn();
    useCollections({ agreements, agreementVersions, outbox });

    const result = await executeAgreementAction(
      {
        agreementNumber: "PMF000000001",
        actionName: "accept",
        payload: {
          code: "pigs-might-fly",
          clientRef: "PMF-APP-001",
          acceptedBy: "applicant",
        },
      },
      "session",
      {
        generateClaimId,
        now: () => "2026-06-01T10:01:00.000Z",
      },
    );

    expect(result.status).toBe("accepted");
    expect(result.version.toDocument()).toEqual(acceptedVersion);
    expect(generateClaimId).not.toHaveBeenCalled();
    expect(agreementVersions.insertOne).not.toHaveBeenCalled();
    expect(outbox.insertMany).not.toHaveBeenCalled();
  });

  it("only runs payment processing when the configured steps include createPaymentClaim", async () => {
    const nonGpsPayment = {
      agreementStartDate: "2026-07-01",
      agreementEndDate: "2027-06-30",
      agreementTotalPence: 10000,
    };
    const agreementWithNonGpsPayment = {
      ...agreementDocument,
      items: [
        {
          ...agreementDocument.items[0],
          payload: {
            answers: {
              payment: nonGpsPayment,
            },
          },
        },
      ],
    };
    const versionWithNonGpsPayment = {
      ...versionDocument,
      snapshot: {
        ...versionDocument.snapshot,
        items: [
          {
            ...versionDocument.snapshot.items[0],
            payload: {
              answers: {
                payment: nonGpsPayment,
              },
            },
          },
        ],
      },
    };
    const agreements = {
      findOne: vi.fn().mockResolvedValue(agreementWithNonGpsPayment),
    };
    const agreementVersions = {
      findOne: vi.fn().mockResolvedValue(versionWithNonGpsPayment),
      insertOne: vi.fn(),
    };
    const outbox = {
      insertMany: vi.fn(),
    };
    useCollections({ agreements, agreementVersions, outbox });

    const result = await executeAgreementAction(
      {
        agreementNumber: "PMF000000001",
        actionName: "accept",
        payload: {
          code: "pigs-might-fly",
          clientRef: "PMF-APP-001",
          acceptedBy: "applicant",
        },
      },
      "session",
      {
        createCorrelationId: () => "correlation-id",
        createId: () => "version-2",
        getAgreementAction: () => ({
          actionName: "accept",
          agreementCode: "pigs-might-fly",
          fromStatus: "offered",
          processingSteps: [
            {
              fromStatus: "offered",
              itemPatch: {
                acceptedAt: "$.executedAt",
                acceptedBy: "$.command.acceptedBy",
                claimId: "$.item.claimId",
                originalInvoiceNumber: "$.item.originalInvoiceNumber",
                payment: "$.item.payload.answers.payment",
              },
              toStatus: "accepted",
              type: "recordTransition",
            },
          ],
          toStatus: "accepted",
        }),
        now: () => "2026-06-01T10:00:00.000Z",
      },
    );

    expect(result.status).toBe("accepted");
    expect(agreementVersions.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          items: [
            expect.objectContaining({
              payment: nonGpsPayment,
              status: "accepted",
            }),
          ],
        }),
      }),
      { session: "session" },
    );
    expect(outbox.insertMany).not.toHaveBeenCalled();
  });

  it("records transition state from a configured endpoint call", async () => {
    const endpointPayment = {
      ...paymentSchedule,
      agreementTotalPence: 20000,
    };
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
    const callEndpoint = vi.fn().mockResolvedValue({
      payment: endpointPayment,
    });
    useCollections({ agreements, agreementVersions, outbox });

    const result = await executeAgreementAction(
      {
        agreementNumber: "PMF000000001",
        actionName: "accept",
        payload: {
          code: "pigs-might-fly",
          clientRef: "PMF-APP-001",
          acceptedBy: "applicant",
        },
      },
      "session",
      {
        callEndpoint,
        createCorrelationId: () => "correlation-id",
        createId: () => "version-2",
        getAgreementAction: () => ({
          actionName: "accept",
          agreementCode: "pigs-might-fly",
          fromStatus: "offered",
          processingSteps: [
            {
              endpoint: {
                code: "calculate-payment-schedule",
                endpointParams: {
                  BODY: {
                    payment: "$.item.payload.answers.payment",
                  },
                },
                method: "POST",
                path: "/api/v2/payments/calculate",
                service: "LAND_GRANTS",
              },
              output: {
                path: "payment",
                place: "replace",
                select: "$.response.payment",
              },
              type: "callEndpoint",
            },
            {
              fromStatus: "offered",
              itemPatch: {
                acceptedAt: "$.executedAt",
                acceptedBy: "$.command.acceptedBy",
                claimId: "$.item.claimId",
                originalInvoiceNumber: "$.item.originalInvoiceNumber",
                payment: "$.action.payment",
              },
              toStatus: "accepted",
              type: "recordTransition",
            },
          ],
          toStatus: "accepted",
        }),
        now: () => "2026-06-01T10:00:00.000Z",
      },
    );

    expect(result.status).toBe("accepted");
    expect(callEndpoint).toHaveBeenCalledWith({
      context: expect.objectContaining({
        item: expect.objectContaining({
          agreementItemId: "agreement-item-id",
        }),
      }),
      endpoint: expect.objectContaining({
        code: "calculate-payment-schedule",
        path: "/api/v2/payments/calculate",
      }),
      params: {
        BODY: {
          payment: paymentSchedule,
        },
      },
    });
    expect(agreementVersions.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          items: [
            expect.objectContaining({
              payment: expect.objectContaining({
                agreementTotalPence: 20000,
              }),
              status: "accepted",
            }),
          ],
        }),
      }),
      { session: "session" },
    );
  });

  it("records transition state from a configured endpoint output target", async () => {
    const endpointPayment = {
      ...paymentSchedule,
      agreementTotalPence: 30000,
    };
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
    const callEndpoint = vi.fn().mockResolvedValue({
      code: "payment",
      payment: endpointPayment,
    });
    useCollections({ agreements, agreementVersions, outbox });

    const result = await executeAgreementAction(
      {
        agreementNumber: "PMF000000001",
        actionName: "accept",
        payload: {
          code: "pigs-might-fly",
          clientRef: "PMF-APP-001",
          acceptedBy: "applicant",
        },
      },
      "session",
      {
        callEndpoint,
        createCorrelationId: () => "correlation-id",
        createId: () => "version-2",
        getAgreementAction: () => ({
          actionName: "accept",
          agreementCode: "pigs-might-fly",
          fromStatus: "offered",
          processingSteps: [
            {
              endpoint: {
                code: "calculate-payment-schedule",
                method: "POST",
                path: "/api/v2/payments/calculate",
                service: "LAND_GRANTS",
              },
              output: {
                select: "$.response",
                target: {
                  dataType: "OBJECT",
                  key: "code",
                  place: "append",
                  targetNode: "paymentPreparations",
                },
              },
              type: "callEndpoint",
            },
            {
              fromStatus: "offered",
              itemPatch: {
                acceptedAt: "$.executedAt",
                acceptedBy: "$.command.acceptedBy",
                payment: "$.action.paymentPreparations.payment.payment",
              },
              toStatus: "accepted",
              type: "recordTransition",
            },
          ],
          toStatus: "accepted",
        }),
        now: () => "2026-06-01T10:00:00.000Z",
      },
    );

    expect(result.status).toBe("accepted");
    expect(agreementVersions.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          items: [
            expect.objectContaining({
              payment: expect.objectContaining({
                agreementTotalPence: 30000,
              }),
              status: "accepted",
            }),
          ],
        }),
      }),
      { session: "session" },
    );
  });

  it("rejects unknown configured lifecycle steps", async () => {
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

    await expect(
      executeAgreementAction(
        {
          agreementNumber: "PMF000000001",
          actionName: "accept",
          payload: {
            code: "pigs-might-fly",
            clientRef: "PMF-APP-001",
            acceptedBy: "applicant",
          },
        },
        "session",
        {
          createCorrelationId: () => "correlation-id",
          getAgreementAction: () => ({
            actionName: "accept",
            agreementCode: "pigs-might-fly",
            fromStatus: "offered",
            processingSteps: [
              {
                fromStatus: "offered",
                itemPatch: {
                  acceptedAt: "$.executedAt",
                  acceptedBy: "$.command.acceptedBy",
                  claimId: "$.item.claimId",
                  originalInvoiceNumber: "$.item.originalInvoiceNumber",
                  payment: "$.item.payload.answers.payment",
                },
                toStatus: "accepted",
                type: "recordTransition",
              },
              {
                fromStatus: "offered",
                toStatus: "accepted",
                type: "unsupportedStep",
              },
            ],
            toStatus: "accepted",
          }),
          now: () => "2026-06-01T10:00:00.000Z",
        },
      ),
    ).rejects.toThrow('Unknown Agreement processing step "unsupportedStep"');
    expect(outbox.insertMany).not.toHaveBeenCalled();
  });
});
