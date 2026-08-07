import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveOutboxEvents } from "../../common/save-outbox-events.js";
import { withTransaction } from "../../common/with-transaction.js";
import { loadAgreementDefinition } from "../models/agreement-definitions/agreement-definition-loader.js";
import { agreementDefinitions } from "../models/agreement-definitions/agreement-definition-registry.js";
import { AgreementDefinition } from "../models/agreement-definitions/agreement-definition.js";
import { generateAgreementNumber } from "../models/agreement-number.js";
import {
  findAgreementBySourceIdentity,
  insertAgreementVersion,
  insertCurrentAgreement,
} from "../repositories/agreement.repository.js";
import { handleCreateAgreementCommandUseCase } from "./handle-create-agreement-command.use-case.js";

vi.mock("../../common/save-outbox-events.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../models/agreement-definitions/agreement-definition-loader.js");
vi.mock("../models/agreement-number.js");
vi.mock("../repositories/agreement.repository.js");

const pmfDefinitionData = agreementDefinitions.find(
  ({ code }) => code === "pigs-might-fly",
);
const command = {
  data: {
    clientRef: "xnp-rr3-nfa",
    code: "pigs-might-fly",
    identifiers: { sbi: "300000069", frn: "1000000000" },
    metadata: { configVersion: "3.0.0", ignored: "legacy metadata" },
    answers: {
      whitePigsCount: 5,
      britishLandracePigsCount: 0,
      berkshirePigsCount: 0,
      otherPigsCount: 0,
    },
    sourceContext: { retainedOnlyInCreationInput: true },
  },
};
const calculatorResult = {
  items: [
    {
      type: "largeWhite",
      description: "Large White Pig",
      value: 10,
      quantity: 5,
      total: 50,
    },
    {
      type: "britishLandrace",
      description: "British Landrace",
      value: 15,
      quantity: 0,
      total: 0,
    },
  ],
  grandTotal: 50,
};
const session = { fake: "session" };

const createDefinition = (
  callEndpoint = vi.fn().mockResolvedValue(calculatorResult),
) => new AgreementDefinition(pmfDefinitionData, { callEndpoint });

const expectNoPersistence = () => {
  expect(withTransaction).not.toHaveBeenCalled();
  expect(insertCurrentAgreement).not.toHaveBeenCalled();
  expect(insertAgreementVersion).not.toHaveBeenCalled();
  expect(saveOutboxEvents).not.toHaveBeenCalled();
};

describe("handleCreateAgreementCommandUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withTransaction.mockImplementation(async (callback) => callback(session));
    findAgreementBySourceIdentity.mockResolvedValue(null);
    loadAgreementDefinition.mockResolvedValue(createDefinition());
    generateAgreementNumber.mockReturnValue("PMF823153883");
  });

  it("maps the complete unchanged Creation Input into an offered Agreement before persisting", async () => {
    const callOrder = [];
    const callEndpoint = vi.fn().mockImplementation(async () => {
      callOrder.push("endpoint");
      return calculatorResult;
    });
    const definition = createDefinition(callEndpoint);
    const resolveApplication = vi.spyOn(definition, "resolveApplication");
    loadAgreementDefinition.mockResolvedValue(definition);
    withTransaction.mockImplementation(async (callback) => {
      callOrder.push("transaction");
      return callback(session);
    });
    const originalInput = structuredClone(command.data);

    const agreement = await handleCreateAgreementCommandUseCase(command);

    expect(resolveApplication).toHaveBeenCalledWith(command.data);
    expect(command.data).toEqual(originalInput);
    expect(callEndpoint).toHaveBeenCalledWith(
      {
        code: "calculate-offer",
        method: "POST",
        path: "/grantFundingCalculator",
        service: "GRANT_FUNDING_CALCULATOR",
      },
      {
        BODY: {
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
      state: "offered",
    });
    expect(agreement).not.toHaveProperty("payload");
    expect(agreement).not.toHaveProperty("supplementaryData");
    expect(JSON.stringify(agreement)).not.toContain("grandTotal");
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
      [
        expect.objectContaining({
          event: expect.objectContaining({
            data: expect.objectContaining({
              agreementNumber: agreement.agreementNumber,
              version: 1,
              status: "offered",
            }),
          }),
        }),
      ],
      session,
    );
  });

  it("allocates stable identities in each configured output order", async () => {
    const response = {
      items: [
        calculatorResult.items[0],
        {
          type: "berkshire",
          description: "Berkshire",
          value: 18,
          quantity: 2,
          total: 36,
        },
      ],
      grandTotal: 86,
    };
    loadAgreementDefinition.mockResolvedValue(
      createDefinition(vi.fn().mockResolvedValue(response)),
    );

    const agreement = await handleCreateAgreementCommandUseCase(command);

    expect(agreement.actions.map(({ id }) => id)).toEqual([
      "action:1",
      "action:2",
    ]);
    expect(agreement.actions.map(({ code }) => code)).toEqual([
      "largeWhite",
      "berkshire",
    ]);
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
          vi.fn().mockResolvedValue({
            ...calculatorResult,
            items: [{ ...calculatorResult.items[0], value: "secret" }],
          }),
        ),
    ],
    [
      "complete Agreement value validation",
      () => {
        const invalidDefinition = structuredClone(pmfDefinitionData);
        delete invalidDefinition.processDefinitions["calculate-offer"].output
          .items;
        return new AgreementDefinition(invalidDefinition, {
          callEndpoint: vi.fn().mockResolvedValue(calculatorResult),
        });
      },
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

  it("uses the default definition version when metadata does not specify one", async () => {
    await handleCreateAgreementCommandUseCase({
      data: { ...command.data, metadata: {} },
    });

    expect(loadAgreementDefinition).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      configVersion: undefined,
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
