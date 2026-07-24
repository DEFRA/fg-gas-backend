import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveOutboxEvents } from "../../common/save-outbox-events.js";
import { withTransaction } from "../../common/with-transaction.js";
import { loadAgreementDefinition } from "../models/agreement-definitions/agreement-definition-loader.js";
import { AgreementDefinition } from "../models/agreement-definitions/agreement-definition.js";
import { generateAgreementNumber } from "../models/agreement-number.js";
import {
  findAgreementBySourceIdentity,
  insertAgreementVersion,
  insertCurrentAgreement,
} from "../repositories/agreement.repository.js";
import { runAgreementEffects } from "../services/effects/agreement-effect-runner.js";
import { handleCreateAgreementCommandUseCase } from "./handle-create-agreement-command.use-case.js";

vi.mock("../../common/save-outbox-events.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../models/agreement-definitions/agreement-definition-loader.js");
vi.mock("../models/agreement-number.js");
vi.mock("../repositories/agreement.repository.js");
vi.mock("../services/effects/agreement-effect-runner.js");

const definitionData = {
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
    identifiers: { sbi: "300000069", frn: "1000000000" },
    metadata: { configVersion: "1.0.1", ignored: "legacy metadata" },
    answers: { whitePigsCount: 5 },
  },
};
const session = { fake: "session" };

describe("handleCreateAgreementCommandUseCase", () => {
  beforeEach(() => {
    withTransaction.mockImplementation(async (callback) => callback(session));
    findAgreementBySourceIdentity.mockResolvedValue(null);
    loadAgreementDefinition.mockResolvedValue(
      new AgreementDefinition(definitionData),
    );
    generateAgreementNumber.mockReturnValue("PMF823153883");
    runAgreementEffects.mockImplementation(async (_effects, context) => ({
      ...context,
      outboundEvents: [],
    }));
  });

  it("persists one current Agreement and an identical Version 1", async () => {
    const agreement = await handleCreateAgreementCommandUseCase(command);

    expect(findAgreementBySourceIdentity).toHaveBeenCalledWith({
      clientRef: "xnp-rr3-nfa",
      code: "pigs-might-fly",
    });
    expect(loadAgreementDefinition).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      configVersion: "1.0.1",
    });
    expect(agreement).toMatchObject({
      agreementNumber: "PMF823153883",
      version: 1,
      code: "pigs-might-fly",
      clientRef: "xnp-rr3-nfa",
      configVersion: "1.0.1",
      identifiers: command.data.identifiers,
      payload: command.data.answers,
      state: "offered",
    });
    expect(agreement).not.toHaveProperty("items");
    expect(agreement).not.toHaveProperty("id");
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
    expect(saveOutboxEvents).toHaveBeenCalledWith([], session);
  });

  it("runs creation effects before opening the transaction and persists their Agreement changes", async () => {
    const callOrder = [];
    runAgreementEffects.mockImplementation(async (_effects, context) => {
      callOrder.push("effects");
      return {
        ...context,
        agreement: {
          ...context.agreement,
          supplementaryData: { fundingCalculation: { total: 32000 } },
        },
        outboxMessageTypes: ["lifecycle"],
      };
    });
    withTransaction.mockImplementation(async (callback) => {
      callOrder.push("transaction");
      return callback(session);
    });

    const agreement = await handleCreateAgreementCommandUseCase(command);

    expect(callOrder).toEqual(["effects", "transaction"]);
    expect(runAgreementEffects).toHaveBeenCalledWith(
      definitionData.create.effects,
      expect.objectContaining({
        answers: command.data.answers,
        agreement: expect.objectContaining({ payload: command.data.answers }),
        target: "offered",
        version: 1,
      }),
    );
    expect(agreement.supplementaryData).toEqual({
      fundingCalculation: { total: 32000 },
    });
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

  it("returns an existing Agreement without rerunning creation", async () => {
    const existingAgreement = { agreementNumber: "PMF823153883" };
    findAgreementBySourceIdentity.mockResolvedValue(existingAgreement);

    await expect(handleCreateAgreementCommandUseCase(command)).resolves.toBe(
      existingAgreement,
    );
    expect(loadAgreementDefinition).not.toHaveBeenCalled();
    expect(runAgreementEffects).not.toHaveBeenCalled();
    expect(withTransaction).not.toHaveBeenCalled();
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
    expect(insertCurrentAgreement).not.toHaveBeenCalled();
    expect(insertAgreementVersion).not.toHaveBeenCalled();
  });
});
