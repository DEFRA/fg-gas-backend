import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../common/with-transaction.js";
import { getAgreementDefinitionForCreation } from "../models/agreement-definitions/index.js";
import { generateAgreementNumber } from "../models/agreement-number.js";
import {
  findByClientRefAndCode,
  saveAgreement,
  saveVersion,
} from "../repositories/agreement.repository.js";
import { runAgreementEffects } from "../services/effects/agreement-effect-runner.js";
import { handleCreateAgreementCommandUseCase } from "./handle-create-agreement-command.use-case.js";

vi.mock("../../common/with-transaction.js");
vi.mock("../models/agreement-definitions/index.js");
vi.mock("../models/agreement-number.js");
vi.mock("../repositories/agreement.repository.js");
vi.mock("../services/effects/agreement-effect-runner.js");

const pmfDefinition = {
  code: "pigs-might-fly",
  configVersion: "0.0.1",
  agreementNumberPrefix: "PMF",
  endpoints: [],
  create: { target: "offered", effects: [] },
};

const command = {
  data: {
    clientRef: "xnp-rr3-nfa",
    code: "pigs-might-fly",
    identifiers: { sbi: "300000069", frn: "frn", crn: "1300000069" },
    metadata: { configVersion: "0.0.1" },
    answers: { whitePigsCount: 5 },
  },
};

const session = { fake: "session" };

describe("handleCreateAgreementCommandUseCase", () => {
  beforeEach(() => {
    withTransaction.mockImplementation(async (callback) => callback(session));
  });

  it("persists a new agreement in its initial state for a known code", async () => {
    findByClientRefAndCode.mockResolvedValue(null);
    getAgreementDefinitionForCreation.mockReturnValue(pmfDefinition);
    generateAgreementNumber.mockReturnValue("PMF823153883");
    saveAgreement.mockResolvedValue();
    saveVersion.mockResolvedValue();
    runAgreementEffects.mockResolvedValue({
      answers: command.data.answers,
      outputs: {},
    });

    const agreement = await handleCreateAgreementCommandUseCase(command);

    expect(findByClientRefAndCode).toHaveBeenCalledWith(
      "xnp-rr3-nfa",
      "pigs-might-fly",
    );
    expect(getAgreementDefinitionForCreation).toHaveBeenCalledWith(
      "pigs-might-fly",
      "0.0.1",
    );
    expect(generateAgreementNumber).toHaveBeenCalledWith({ prefix: "PMF" });
    expect(runAgreementEffects).toHaveBeenCalledWith(
      pmfDefinition.create.effects,
      { answers: command.data.answers, outputs: {}, endpoints: [] },
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
      status: "offered",
    });

    expect(saveVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        agreementId: agreement.id,
        agreementNumber: agreement.agreementNumber,
        version: 1,
        snapshot: expect.objectContaining({
          items: [
            expect.objectContaining({
              agreementCode: "pigs-might-fly",
              status: "offered",
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
        params: { fundingCalculation: "$.outputs.fundingCalculation" },
      },
    ];
    const definitionWithEffects = {
      ...pmfDefinition,
      endpoints: [{ code: "calculate-funding" }],
      create: { target: "offered", effects },
    };

    findByClientRefAndCode.mockResolvedValue(null);
    getAgreementDefinitionForCreation.mockReturnValue(definitionWithEffects);
    generateAgreementNumber.mockReturnValue("PMF823153883");
    saveAgreement.mockResolvedValue();
    saveVersion.mockResolvedValue();

    const fundingCalculation = {
      items: [{ description: "Large White", total: 320 }],
    };

    const callOrder = [];
    runAgreementEffects.mockImplementation(async () => {
      callOrder.push("effects");
      return {
        answers: command.data.answers,
        outputs: { fundingCalculation },
        supplementaryData: { fundingCalculation },
      };
    });
    withTransaction.mockImplementation(async (callback) => {
      callOrder.push("transaction");
      return callback(session);
    });

    const agreement = await handleCreateAgreementCommandUseCase(command);

    expect(callOrder).toEqual(["effects", "transaction"]);
    expect(runAgreementEffects).toHaveBeenCalledWith(effects, {
      answers: command.data.answers,
      outputs: {},
      endpoints: definitionWithEffects.endpoints,
    });
    expect(saveVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        snapshot: expect.objectContaining({
          items: [
            expect.objectContaining({
              status: "offered",
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
    getAgreementDefinitionForCreation.mockReturnValue(pmfDefinition);
    generateAgreementNumber.mockReturnValue("PMF823153883");
    runAgreementEffects.mockResolvedValue({
      answers: unversionedCommand.data.answers,
      outputs: {},
    });

    const agreement =
      await handleCreateAgreementCommandUseCase(unversionedCommand);

    expect(getAgreementDefinitionForCreation).toHaveBeenCalledWith(
      "pigs-might-fly",
      undefined,
    );
    expect(agreement.items[0].configVersion).toBe("0.0.1");
  });

  it("throws Boom.badRequest for an unknown agreement definition", async () => {
    findByClientRefAndCode.mockResolvedValue(null);
    getAgreementDefinitionForCreation.mockReturnValue(undefined);

    await expect(handleCreateAgreementCommandUseCase(command)).rejects.toThrow(
      'Unknown agreement definition: "pigs-might-fly" version "0.0.1"',
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
    expect(getAgreementDefinitionForCreation).not.toHaveBeenCalled();
    expect(runAgreementEffects).not.toHaveBeenCalled();
    expect(saveAgreement).not.toHaveBeenCalled();
    expect(saveVersion).not.toHaveBeenCalled();
  });
});
