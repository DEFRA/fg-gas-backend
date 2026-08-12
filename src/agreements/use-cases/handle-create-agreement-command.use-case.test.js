import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pmfAgreementDefinitionFixture } from "../../../test/fixtures/pmf-agreement-definition.js";
import { saveOutboxEvents } from "../../common/save-outbox-events.js";
import { withTransaction } from "../../common/with-transaction.js";
import { AgreementDefinition } from "../models/agreement-definitions/agreement-definition.js";
import {
  findAgreementBySourceIdentity,
  insertAgreementVersion,
  insertCurrentAgreement,
} from "../repositories/agreement.repository.js";
import { handleCreateAgreementCommandUseCase } from "./handle-create-agreement-command.use-case.js";
import { loadAgreementDefinition } from "./load-agreement-definition.js";

vi.mock("../../common/save-outbox-events.js");
vi.mock("../../common/with-transaction.js");
vi.mock("./load-agreement-definition.js");
vi.mock("../repositories/agreement.repository.js");

const pmfDefinitionData = {
  ...structuredClone(pmfAgreementDefinitionFixture),
  configVersion: "1.2.0",
};
const executedAt = "2026-08-06T12:00:00.000Z";
const command = {
  data: {
    clientRef: "xnp-rr3-nfa",
    code: "pigs-might-fly",
    identifiers: { sbi: "300000069", frn: "1000000000" },
    currentConfigVersion: "3.0.0",
    metadata: { configVersion: "legacy-version", ignored: "legacy metadata" },
    answers: {
      whitePigsCount: 5,
      britishLandracePigsCount: 0,
      berkshirePigsCount: 0,
      otherPigsCount: 0,
    },
    sourceContext: { retainedOnlyInCreationInput: true },
  },
};
const largeWhiteLine = {
  pigType: "largeWhite",
  description: "Large White Pig",
  quantity: 5,
  unitPricePence: 1000,
  amountPence: 5000,
};
const calculatorResult = {
  payment: {
    agreementStartDate: "2026-08-06",
    agreementEndDate: "2027-08-05",
    agreementTotalPence: 5000,
    payments: [
      {
        dueDate: "2026-11-11",
        totalAmountPence: 5000,
        invoiceLines: [largeWhiteLine],
      },
    ],
  },
};
const session = { fake: "session" };
const fpttCommand = {
  data: {
    clientRef: "fptt-client-ref",
    code: "frps-private-beta",
    identifiers: { sbi: "300000069", frn: "1000000000" },
    answers: {
      parcel: [
        {
          sheetId: "SD8545",
          parcelId: "9935",
          area: { quantity: 0.0321, unit: "ha" },
        },
      ],
      agreement: [],
      actionApplications: [
        {
          code: "CMOR1",
          version: "2.0.0",
          sheetId: "SD8545",
          parcelId: "9935",
          durationYears: 1,
          appliedFor: { quantity: 0.0321, unit: "ha" },
        },
      ],
      consentObjects: [],
    },
  },
};
const fpttDefinitionData = {
  code: "frps-private-beta",
  configVersion: "1.0.0",
  agreementNumberPrefix: "FPTT",
  create: {
    target: "offered",
    application: "$.input.answers",
    values: {
      schemeCode: "SFI",
      parcels: {
        itemsRef: "$.application.parcel",
        items: {
          id: "jsonata:@.sheetId & '-' & @.parcelId",
          sheetId: "@.sheetId",
          parcelId: "@.parcelId",
          area: "@.area",
        },
      },
      actions: {
        itemsRef: "$.application.actionApplications",
        items: {
          ref: "jsonata:@.sheetId & '-' & @.parcelId & ':' & @.code",
          code: "@.code",
          version: "@.version",
          parcel: "jsonata:@.sheetId & '-' & @.parcelId",
          quantity: "@.appliedFor.quantity",
          unit: "@.appliedFor.unit",
          durationYears: "@.durationYears",
        },
      },
      items: [],
    },
    processes: [],
  },
  states: { offered: { page: "offered" } },
  pages: {
    offered: {
      title: "FPTT offer",
      components: [{ component: "heading", text: "FPTT offer" }],
    },
  },
};
const createDefinition = (
  callEndpoint = vi.fn().mockResolvedValue(calculatorResult),
  definitionData = pmfDefinitionData,
  agreementNumber = "PMF823153883",
) =>
  new AgreementDefinition(definitionData, {
    callEndpoint,
    generateAgreementNumber: () => agreementNumber,
  });

const expectNoPersistence = () => {
  expect(withTransaction).not.toHaveBeenCalled();
  expect(insertCurrentAgreement).not.toHaveBeenCalled();
  expect(insertAgreementVersion).not.toHaveBeenCalled();
  expect(saveOutboxEvents).not.toHaveBeenCalled();
};

const withInvoiceLines = (invoiceLines, totalAmountPence) => ({
  payment: {
    ...calculatorResult.payment,
    agreementTotalPence: totalAmountPence,
    payments: [
      {
        ...calculatorResult.payment.payments[0],
        totalAmountPence,
        invoiceLines,
      },
    ],
  },
});

describe("handleCreateAgreementCommandUseCase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(executedAt);
    vi.clearAllMocks();
    withTransaction.mockImplementation(async (callback) => callback(session));
    findAgreementBySourceIdentity.mockResolvedValue(null);
    loadAgreementDefinition.mockResolvedValue(createDefinition());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds the complete offered Agreement from one configured Payment Schedule call before persisting", async () => {
    const callOrder = [];
    const callEndpoint = vi.fn().mockImplementation(async () => {
      callOrder.push("endpoint");
      return calculatorResult;
    });
    const definition = createDefinition(callEndpoint);
    loadAgreementDefinition.mockResolvedValue(definition);
    withTransaction.mockImplementation(async (callback) => {
      callOrder.push("transaction");
      return callback(session);
    });
    const originalInput = structuredClone(command.data);

    const agreement = await handleCreateAgreementCommandUseCase(command);

    expect(command.data).toEqual(originalInput);
    expect(callEndpoint).toHaveBeenCalledOnce();
    expect(callEndpoint).toHaveBeenCalledWith(
      {
        code: "GENERATE_OFFER",
        method: "POST",
        path: "/paymentSchedule",
        service: "GRANT_FUNDING_CALCULATOR",
      },
      {
        BODY: {
          agreementStartDate: executedAt,
          pigTypes: [
            { pigType: "largeWhite", quantity: 5 },
            { pigType: "britishLandrace", quantity: 0 },
            { pigType: "berkshire", quantity: 0 },
            { pigType: "other", quantity: 0 },
          ],
        },
      },
    );
    expect(callOrder).toEqual(["endpoint", "transaction"]);
    expect(agreement).toMatchObject({
      agreementNumber: "PMF823153883",
      version: 1,
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      configVersion: "1.2.0",
      identifiers: command.data.identifiers,
      application: command.data.answers,
      startDate: "2026-08-06",
      endDate: "2027-08-05",
      actions: [
        {
          id: "action:1",
          code: "largeWhite",
          description: "Large White Pig",
          quantity: 5,
          unit: "head",
          ratePence: 1000,
          totalAmountPence: 5000,
        },
      ],
      items: [],
      totalAmountPence: 5000,
      paymentSchedule: {
        instalments: [
          {
            id: "instalment:1",
            dueDate: "2026-11-11",
            totalAmountPence: 5000,
            lineItems: [{ actionId: "action:1", amountPence: 5000 }],
          },
        ],
      },
      state: "offered",
    });
    expect(agreement).not.toHaveProperty("payload");
    expect(agreement).not.toHaveProperty("supplementaryData");
    expect(JSON.stringify(agreement)).not.toContain("paymentCalculation");
    expect(JSON.stringify(agreement)).not.toContain("pigType");
    expect(JSON.stringify(agreement)).not.toContain('"ref"');
    expect(JSON.stringify(agreement)).not.toContain("actionRef");
    expect(insertCurrentAgreement).toHaveBeenCalledWith(agreement, session);
    expect(insertAgreementVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        agreementNumber: agreement.agreementNumber,
        version: 1,
        snapshot: agreement,
        versionedAt: agreement.createdAt,
      }),
      session,
    );
    expect(saveOutboxEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({
            data: expect.objectContaining({
              agreementNumber: agreement.agreementNumber,
              version: 1,
              status: "offered",
            }),
          }),
        }),
      ]),
      session,
    );
  });

  it("creates FPTT-shaped Parcels and Revenue Actions without calculating a Payment Schedule", async () => {
    const callEndpoint = vi.fn();
    loadAgreementDefinition.mockResolvedValue(
      new AgreementDefinition(fpttDefinitionData, {
        callEndpoint,
        generateAgreementNumber: () => "FPTT123456789",
      }),
    );

    const agreement = await handleCreateAgreementCommandUseCase(fpttCommand);

    expect(callEndpoint).not.toHaveBeenCalled();
    expect(agreement).toMatchObject({
      agreementNumber: "FPTT123456789",
      schemeCode: "SFI",
      application: fpttCommand.data.answers,
      parcels: [
        {
          id: "SD8545-9935",
          sheetId: "SD8545",
          parcelId: "9935",
          area: { quantity: 0.0321, unit: "ha" },
        },
      ],
      actions: [
        {
          id: "action:1",
          code: "CMOR1",
          version: "2.0.0",
          parcel: "SD8545-9935",
          quantity: 0.0321,
          unit: "ha",
          durationYears: 1,
        },
      ],
      items: [],
      state: "offered",
    });
    expect(agreement.paymentSchedule).toBeUndefined();
  });

  it("allocates identities by mapped order and resolves references without relying on Action code uniqueness", async () => {
    const berkshireLine = {
      pigType: "berkshire",
      description: "Berkshire",
      quantity: 2,
      unitPricePence: 1800,
      amountPence: 3600,
    };
    const response = withInvoiceLines([largeWhiteLine, berkshireLine], 8600);
    const definitionData = structuredClone(pmfDefinitionData);
    definitionData.processDefinitions.GENERATE_OFFER.output.actions.items.code =
      "DUPLICATE-CODE";
    const instalmentMapping =
      definitionData.processDefinitions.GENERATE_OFFER.output.paymentSchedule
        .instalments.items;
    instalmentMapping.correlationId = "configured-payment-correlation";
    instalmentMapping.lineItems.items.description =
      "Configured Payment description";
    loadAgreementDefinition.mockResolvedValue(
      createDefinition(vi.fn().mockResolvedValue(response), definitionData),
    );

    const agreement = await handleCreateAgreementCommandUseCase(command);

    expect(agreement.actions).toEqual([
      expect.objectContaining({ id: "action:1", code: "DUPLICATE-CODE" }),
      expect.objectContaining({ id: "action:2", code: "DUPLICATE-CODE" }),
    ]);
    expect(agreement.paymentSchedule.instalments).toEqual([
      expect.objectContaining({
        id: "instalment:1",
        correlationId: "configured-payment-correlation",
        lineItems: [
          {
            actionId: "action:1",
            amountPence: 5000,
            description: "Configured Payment description",
          },
          {
            actionId: "action:2",
            amountPence: 3600,
            description: "Configured Payment description",
          },
        ],
      }),
    ]);
  });

  it("allocates identities for unscheduled entries without candidate references", async () => {
    const definitionData = structuredClone(pmfDefinitionData);
    const output = definitionData.processDefinitions.GENERATE_OFFER.output;
    delete output.actions.items.ref;
    delete output.paymentSchedule;
    loadAgreementDefinition.mockResolvedValue(
      createDefinition(
        vi.fn().mockResolvedValue(calculatorResult),
        definitionData,
      ),
    );

    const agreement = await handleCreateAgreementCommandUseCase(command);

    expect(agreement.actions).toEqual([
      expect.objectContaining({ id: "action:1", code: "largeWhite" }),
    ]);
    expect(agreement.paymentSchedule).toBeUndefined();
  });

  it.each([
    [
      "endpoint execution",
      () => createDefinition(vi.fn().mockRejectedValue(Boom.badGateway())),
    ],
    [
      "mapped candidate validation",
      () =>
        createDefinition(
          vi
            .fn()
            .mockResolvedValue(
              withInvoiceLines(
                [{ ...largeWhiteLine, unitPricePence: "secret" }],
                5000,
              ),
            ),
        ),
    ],
    [
      "ambiguous candidate references",
      () =>
        createDefinition(
          vi
            .fn()
            .mockResolvedValue(
              withInvoiceLines([largeWhiteLine, largeWhiteLine], 10000),
            ),
        ),
    ],
    [
      "unknown candidate references",
      () => {
        const definitionData = structuredClone(pmfDefinitionData);
        definitionData.processDefinitions.GENERATE_OFFER.output.actions.itemsRef =
          "jsonata:$.response.payment.payments[0].invoiceLines[0]";
        const berkshireLine = {
          pigType: "berkshire",
          description: "Berkshire",
          quantity: 1,
          unitPricePence: 1800,
          amountPence: 1800,
        };
        return createDefinition(
          vi
            .fn()
            .mockResolvedValue(
              withInvoiceLines([largeWhiteLine, berkshireLine], 6800),
            ),
          definitionData,
        );
      },
    ],
    [
      "complete Agreement value validation",
      () =>
        createDefinition(
          vi.fn().mockResolvedValue({
            payment: {
              ...calculatorResult.payment,
              payments: [
                {
                  ...calculatorResult.payment.payments[0],
                  totalAmountPence: 1,
                },
              ],
            },
          }),
        ),
    ],
  ])("persists nothing when %s fails", async (_failure, definitionFactory) => {
    loadAgreementDefinition.mockResolvedValue(definitionFactory());

    await expect(
      handleCreateAgreementCommandUseCase(command),
    ).rejects.toThrow();

    expectNoPersistence();
  });

  it("returns an existing Agreement without resolving or calculating creation", async () => {
    const existingAgreement = { agreementNumber: "PMF823153883" };
    findAgreementBySourceIdentity.mockResolvedValue(existingAgreement);

    await expect(handleCreateAgreementCommandUseCase(command)).resolves.toBe(
      existingAgreement,
    );
    expect(loadAgreementDefinition).not.toHaveBeenCalled();
    expectNoPersistence();
  });

  it("returns the concurrently created Agreement after a source-identity conflict", async () => {
    const conflict = new MongoServerError("duplicate source identity");
    conflict.code = 11000;
    conflict.keyPattern = { code: 1, clientRef: 1 };
    const winner = { agreementNumber: "PMF000000001" };
    findAgreementBySourceIdentity
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    withTransaction.mockRejectedValue(conflict);

    await expect(handleCreateAgreementCommandUseCase(command)).resolves.toBe(
      winner,
    );
    expect(findAgreementBySourceIdentity).toHaveBeenLastCalledWith({
      clientRef: "xnp-rr3-nfa",
      code: "pigs-might-fly",
    });
  });

  it("loads the creation definition from currentConfigVersion", async () => {
    await handleCreateAgreementCommandUseCase(command);

    expect(loadAgreementDefinition).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      configVersion: "3.0.0",
      resolution: "creation",
    });
  });

  it("writes nothing when definition loading fails", async () => {
    loadAgreementDefinition.mockRejectedValue(
      Boom.badImplementation("Agreement definition is unavailable"),
    );

    await expect(handleCreateAgreementCommandUseCase(command)).rejects.toThrow(
      "Agreement definition is unavailable",
    );
    expectNoPersistence();
  });
});
