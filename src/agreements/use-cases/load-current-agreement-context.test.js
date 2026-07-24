import { describe, expect, it, vi } from "vitest";
import { loadAgreementDefinition } from "../models/agreement-definitions/agreement-definition-loader.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";
import { loadCurrentAgreementByNumber } from "./load-current-agreement.js";

vi.mock("../models/agreement-definitions/agreement-definition-loader.js");
vi.mock("./load-current-agreement.js");

describe("loadCurrentAgreementContext", () => {
  it("loads the definition version recorded by the Agreement", async () => {
    const agreement = {
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      configVersion: "1.0.1",
    };
    const agreementDefinition = {};
    loadCurrentAgreementByNumber.mockResolvedValue(agreement);
    loadAgreementDefinition.mockResolvedValue(agreementDefinition);

    await expect(
      loadCurrentAgreementContext({
        agreementNumber: agreement.agreementNumber,
      }),
    ).resolves.toEqual({ agreement, agreementDefinition });
    expect(loadAgreementDefinition).toHaveBeenCalledWith({
      code: agreement.code,
      configVersion: agreement.configVersion,
    });
  });
});
