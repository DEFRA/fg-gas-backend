import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAgreementDefinition } from "../models/agreement-definitions/agreement-definition-loader.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";
import { loadCurrentAgreement } from "./load-current-agreement.js";

vi.mock("../models/agreement-definitions/agreement-definition-loader.js");
vi.mock("./load-current-agreement.js");

const request = {
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
};

const currentAgreement = {
  code: "pigs-might-fly",
  configVersion: "0.0.1",
};

const agreementDefinition = { code: "pigs-might-fly", version: "0.0.1" };

describe("loadCurrentAgreementContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCurrentAgreement.mockResolvedValue(currentAgreement);
    loadAgreementDefinition.mockResolvedValue(agreementDefinition);
  });

  it("loads the Agreement Definition matching the Current Agreement config version", async () => {
    await expect(loadCurrentAgreementContext(request)).resolves.toEqual({
      currentAgreement,
      agreementDefinition,
    });

    expect(loadCurrentAgreement).toHaveBeenCalledWith(request);
    expect(loadAgreementDefinition).toHaveBeenCalledWith({
      code: currentAgreement.code,
      configVersion: currentAgreement.configVersion,
    });
  });
});
