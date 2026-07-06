import { describe, expect, it, vi } from "vitest";
import { getAgreementDefinitionByCode } from "../models/agreement-definitions/index.js";
import { generateAgreementNumber } from "../models/agreement-number.js";
import {
  findByClientRefAndCode,
  saveAgreement,
} from "../repositories/agreement.repository.js";
import { handleCreateAgreementCommand } from "./handle-create-agreement-command.use-case.js";

vi.mock("../models/agreement-definitions/index.js");
vi.mock("../models/agreement-number.js");
vi.mock("../repositories/agreement.repository.js");

const pmfDefinition = {
  code: "pigs-might-fly",
  configVersion: "0.0.1",
  agreementNumberPrefix: "PMF",
  create: { target: "offered", effects: [] },
};

const command = {
  data: {
    clientRef: "xnp-rr3-nfa",
    code: "pigs-might-fly",
    identifiers: { sbi: "300000069", frn: "frn", crn: "1300000069" },
    answers: { whitePigsCount: 5 },
  },
};

describe("handleCreateAgreementCommand", () => {
  it("persists a new agreement in its initial state for a known code", async () => {
    findByClientRefAndCode.mockResolvedValue(null);
    getAgreementDefinitionByCode.mockReturnValue(pmfDefinition);
    generateAgreementNumber.mockReturnValue("PMF823153883");
    saveAgreement.mockResolvedValue();

    const session = { fake: "session" };
    const agreement = await handleCreateAgreementCommand(command, session);

    expect(findByClientRefAndCode).toHaveBeenCalledWith(
      "xnp-rr3-nfa",
      "pigs-might-fly",
      session,
    );
    expect(getAgreementDefinitionByCode).toHaveBeenCalledWith("pigs-might-fly");
    expect(generateAgreementNumber).toHaveBeenCalledWith({ prefix: "PMF" });
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
    });
  });

  it("throws Boom.badRequest for an unknown agreement code", async () => {
    findByClientRefAndCode.mockResolvedValue(null);
    getAgreementDefinitionByCode.mockReturnValue(undefined);

    await expect(handleCreateAgreementCommand(command)).rejects.toThrow(
      'Unknown agreement code: "pigs-might-fly"',
    );
    expect(saveAgreement).not.toHaveBeenCalled();
  });

  it("returns the existing agreement without re-creating it when the command is redelivered", async () => {
    const existingAgreement = {
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      identifiers: command.data.identifiers,
      items: [],
    };
    findByClientRefAndCode.mockResolvedValue(existingAgreement);

    const session = { fake: "session" };
    const agreement = await handleCreateAgreementCommand(command, session);

    expect(findByClientRefAndCode).toHaveBeenCalledWith(
      "xnp-rr3-nfa",
      "pigs-might-fly",
      session,
    );
    expect(agreement).toBe(existingAgreement);
    expect(getAgreementDefinitionByCode).not.toHaveBeenCalled();
    expect(saveAgreement).not.toHaveBeenCalled();
  });
});
