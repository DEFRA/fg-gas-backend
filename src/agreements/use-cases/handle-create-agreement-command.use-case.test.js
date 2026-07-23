import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveOutboxEvents } from "../../common/save-outbox-events.js";
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

vi.mock("../../common/save-outbox-events.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../models/agreement-definitions/agreement-definition-loader.js");
vi.mock("../models/agreement-number.js");
vi.mock("../repositories/agreement.repository.js");
vi.mock("../services/effects/agreement-effect-runner.js");

const pmfDefinition = {
  code: "pigs-might-fly",
  configVersion: "1.0.1",
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
    metadata: { configVersion: "1.0.1" },
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
    loadAgreementDefinition.mockResolvedValue(
      new AgreementDefinition(pmfDefinition),
    );
    generateAgreementNumber.mockReturnValue("PMF823153883");
    saveAgreement.mockResolvedValue();
    saveVersion.mockResolvedValue();
    runAgreementEffects.mockImplementation(async (_effects, context) => ({
      ...context,
      outboundEvents: [],
    }));

    const agreement = await handleCreateAgreementCommandUseCase(command);

    expect(findByClientRefAndCode).toHaveBeenCalledWith(
      "xnp-rr3-nfa",
      "pigs-might-fly",
    );
    expect(loadAgreementDefinition).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      configVersion: "1.0.1",
    });
    expect(generateAgreementNumber).toHaveBeenCalledWith({ prefix: "PMF" });
    expect(runAgreementEffects).toHaveBeenCalledWith(
      pmfDefinition.create.effects,
      expect.objectContaining({
        agreement,
        answers: command.data.answers,
        item: agreement.items[0],
        outputs: {},
        endpoints: [],
        target: "offered",
        version: 1,
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
      configVersion: "1.0.1",
      identifiers: command.data.identifiers,
      payload: command.data.answers,
      state: "offered",
    });

    expect(saveOutboxEvents).toHaveBeenCalledWith([], session);
    expect(saveVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        agreementId: agreement.id,
        agreementNumber: agreement.agreementNumber,
        version: 1,
        snapshot: expect.objectContaining({
          items: [
            expect.objectContaining({
              agreementCode: "pigs-might-fly",
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
        params: { fundingCalculation: "$.outputs.fundingCalculation" },
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
    runAgreementEffects.mockImplementation(async () => {
      callOrder.push("effects");
      return {
        answers: command.data.answers,
        outputs: { fundingCalculation },
        item: {
          agreementItemId: "item-id",
          state: "offered",
          supplementaryData: { fundingCalculation },
        },
        outboundEvents: [{ event: { data: {} }, target: "some:arn" }],
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
        agreement,
        answers: command.data.answers,
        item: agreement.items[0],
        outputs: {},
        endpoints: definitionWithEffects.endpoints,
        target: "offered",
        version: 1,
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
    expect(saveOutboxEvents).toHaveBeenCalledWith(
      [{ event: { data: {} }, target: "some:arn" }],
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
    runAgreementEffects.mockImplementation(async (_effects, context) => ({
      ...context,
      outboundEvents: [],
    }));

    const agreement =
      await handleCreateAgreementCommandUseCase(unversionedCommand);

    expect(loadAgreementDefinition).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      configVersion: undefined,
    });
    expect(agreement.items[0].configVersion).toBe("1.0.1");
  });

  it("throws Boom.badImplementation for an unavailable agreement definition", async () => {
    findByClientRefAndCode.mockResolvedValue(null);
    loadAgreementDefinition.mockRejectedValue(
      Boom.badImplementation(
        'Agreement definition "pigs-might-fly" version "1.0.1" is unavailable',
      ),
    );

    await expect(handleCreateAgreementCommandUseCase(command)).rejects.toThrow(
      'Agreement definition "pigs-might-fly" version "1.0.1" is unavailable',
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
