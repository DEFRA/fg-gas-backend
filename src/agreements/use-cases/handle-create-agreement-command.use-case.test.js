import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../common/with-transaction.js";
import { loadAgreementDefinition } from "../models/agreement-definitions/agreement-definition-loader.js";
import { AgreementDefinition } from "../models/agreement-definitions/agreement-definition.js";
import { generateAgreementNumber } from "../models/agreement-number.js";
import {
  findByClientRefAndCode,
  saveAgreement,
  saveVersion,
} from "../repositories/agreement.repository.js";
import { runAgreementEffects } from "../services/effects/agreement-effect-runner.js";
import { handleCreateAgreementCommandUseCase } from "./handle-create-agreement-command.use-case.js";

vi.mock("../../common/with-transaction.js");
vi.mock("../models/agreement-definitions/agreement-definition-loader.js");
vi.mock("../models/agreement-number.js");
vi.mock("../repositories/agreement.repository.js");
vi.mock("../services/effects/agreement-effect-runner.js");

const pmfDefinition = {
  code: "pigs-might-fly",
  configVersion: "0.0.1",
  agreementNumberPrefix: "PMF",
  endpoints: [],
  create: { target: "offered", effects: [] },
  states: { offered: { page: "offered" } },
  pages: {
    offered: {
      title: "Agreement offer",
      components: [{ component: "heading", text: "Agreement offer" }],
    },
  },
};

const command = {
  data: {
    clientRef: "xnp-rr3-nfa",
    code: "pigs-might-fly",
    identifiers: { sbi: "300000069", frn: "frn", crn: "1300000069" },
    metadata: {
      configVersion: "0.0.1",
      correlationId: "application-correlation-id",
    },
    answers: { whitePigsCount: 5 },
  },
};

const session = { fake: "session" };

describe("handleCreateAgreementCommandUseCase", () => {
  beforeEach(() => {
    withTransaction.mockImplementation(async (callback) => callback(session));
    runAgreementEffects.mockImplementation(
      async (_effects, context) => context,
    );
  });

  it("persists a new agreement in its initial state for a known code", async () => {
    findByClientRefAndCode.mockResolvedValue(null);
    loadAgreementDefinition.mockResolvedValue(
      new AgreementDefinition(pmfDefinition),
    );
    generateAgreementNumber.mockReturnValue("PMF823153883");
    saveAgreement.mockResolvedValue();
    saveVersion.mockResolvedValue();
    const agreement = await handleCreateAgreementCommandUseCase(command);

    expect(findByClientRefAndCode).toHaveBeenCalledWith(
      "xnp-rr3-nfa",
      "pigs-might-fly",
    );
    expect(loadAgreementDefinition).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      configVersion: "0.0.1",
    });
    expect(generateAgreementNumber).toHaveBeenCalledWith({ prefix: "PMF" });
    expect(runAgreementEffects).toHaveBeenCalledWith(
      pmfDefinition.create.effects,
      expect.objectContaining({
        answers: command.data.answers,
        outputs: {},
        item: expect.objectContaining({
          agreementCode: "pigs-might-fly",
          state: "offered",
        }),
        endpoints: [],
      }),
    );
    expect(saveAgreement).toHaveBeenCalledWith(agreement, session);
    expect(agreement).toMatchObject({
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      identifiers: command.data.identifiers,
    });
    expect(agreement.items).toHaveLength(1);
    expect(agreement.items[0]).toMatchObject({
      agreementCode: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      sourceSystem: "GAS",
      configVersion: "0.0.1",
      identifiers: command.data.identifiers,
      payload: command.data.answers,
      state: "offered",
    });
    expect(agreement.items[0].correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(agreement.items[0].correlationId).not.toBe(
      command.data.metadata.correlationId,
    );

    expect(saveVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        agreementId: agreement.id,
        agreementNumber: agreement.agreementNumber,
        version: 1,
        snapshot: expect.objectContaining({
          items: [
            expect.objectContaining({
              agreementCode: "pigs-might-fly",
              correlationId: agreement.items[0].correlationId,
              state: "offered",
              supplementaryData: undefined,
            }),
          ],
        }),
      }),
      session,
    );
  });

  it("runs create effects through the generic runner (before opening a transaction) and snapshots their output into version 1", async () => {
    const effects = [
      { name: "callEndpoint", output: "fundingCalculation" },
      {
        name: "snapshot",
        params: {
          supplementaryData: {
            fundingCalculation: "$.outputs.fundingCalculation",
          },
        },
      },
    ];
    const definitionWithEffects = {
      ...pmfDefinition,
      endpoints: [
        {
          code: "calculate-funding",
          method: "POST",
          path: "/calculate",
          service: "CALCULATOR",
        },
      ],
      create: { target: "offered", effects },
    };

    findByClientRefAndCode.mockResolvedValue(null);
    loadAgreementDefinition.mockResolvedValue(
      new AgreementDefinition(definitionWithEffects),
    );
    generateAgreementNumber.mockReturnValue("PMF823153883");
    saveAgreement.mockResolvedValue();
    saveVersion.mockResolvedValue();

    const fundingCalculation = {
      items: [{ description: "Large White", total: 320 }],
    };

    const callOrder = [];
    runAgreementEffects.mockImplementation(async (_effects, context) => {
      callOrder.push("effects");
      return {
        ...context,
        outputs: { fundingCalculation },
        item: {
          ...context.item,
          supplementaryData: { fundingCalculation },
        },
      };
    });
    withTransaction.mockImplementation(async (callback) => {
      callOrder.push("transaction");
      return callback(session);
    });

    const agreement = await handleCreateAgreementCommandUseCase(command);

    expect(callOrder).toEqual(["effects", "transaction"]);
    expect(runAgreementEffects).toHaveBeenCalledWith(
      effects,
      expect.objectContaining({
        answers: command.data.answers,
        outputs: {},
        item: expect.objectContaining({ state: "offered" }),
        endpoints: definitionWithEffects.endpoints,
      }),
    );
    expect(saveVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        snapshot: expect.objectContaining({
          items: [
            expect.objectContaining({
              state: "offered",
              supplementaryData: { fundingCalculation },
            }),
          ],
        }),
      }),
      session,
    );
    expect(agreement.items[0].supplementaryData).toBeUndefined();
  });

  it("persists the registry default version when the command omits one", async () => {
    const unversionedCommand = {
      data: { ...command.data, metadata: {} },
    };
    findByClientRefAndCode.mockResolvedValue(null);
    loadAgreementDefinition.mockResolvedValue(
      new AgreementDefinition(pmfDefinition),
    );
    generateAgreementNumber.mockReturnValue("PMF823153883");
    const agreement =
      await handleCreateAgreementCommandUseCase(unversionedCommand);

    expect(loadAgreementDefinition).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      configVersion: undefined,
    });
    expect(agreement.items[0].configVersion).toBe("0.0.1");
  });

  it("creates a correlation ID when the command does not supply one", async () => {
    const commandWithoutCorrelationId = {
      data: {
        ...command.data,
        metadata: { configVersion: "0.0.1" },
      },
    };
    findByClientRefAndCode.mockResolvedValue(null);
    loadAgreementDefinition.mockResolvedValue(
      new AgreementDefinition(pmfDefinition),
    );
    generateAgreementNumber.mockReturnValue("PMF823153883");

    const agreement = await handleCreateAgreementCommandUseCase(
      commandWithoutCorrelationId,
    );

    expect(agreement.items[0].correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("throws Boom.badImplementation for an unavailable agreement definition", async () => {
    findByClientRefAndCode.mockResolvedValue(null);
    loadAgreementDefinition.mockRejectedValue(
      Boom.badImplementation(
        'Agreement definition "pigs-might-fly" version "0.0.1" is unavailable',
      ),
    );

    await expect(handleCreateAgreementCommandUseCase(command)).rejects.toThrow(
      'Agreement definition "pigs-might-fly" version "0.0.1" is unavailable',
    );
    expect(saveAgreement).not.toHaveBeenCalled();
    expect(saveVersion).not.toHaveBeenCalled();
  });

  it("returns the existing agreement without re-creating it when the command is redelivered", async () => {
    const existingAgreement = {
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      identifiers: command.data.identifiers,
      items: [],
    };
    findByClientRefAndCode.mockResolvedValue(existingAgreement);

    const agreement = await handleCreateAgreementCommandUseCase(command);

    expect(findByClientRefAndCode).toHaveBeenCalledWith(
      "xnp-rr3-nfa",
      "pigs-might-fly",
    );
    expect(agreement).toBe(existingAgreement);
    expect(loadAgreementDefinition).not.toHaveBeenCalled();
    expect(runAgreementEffects).not.toHaveBeenCalled();
    expect(saveAgreement).not.toHaveBeenCalled();
    expect(saveVersion).not.toHaveBeenCalled();
  });
});
