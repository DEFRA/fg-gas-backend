import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAgreementDefinition } from "../models/agreement-definitions/agreement-definition-loader.js";
import {
  loadCurrentAgreementContextByItem,
  loadCurrentAgreementContextByReference,
} from "./load-current-agreement-context.js";
import {
  loadCurrentAgreement,
  loadCurrentAgreementByItem,
} from "./load-current-agreement.js";

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
    loadCurrentAgreementByItem.mockResolvedValue(currentAgreement);
    loadAgreementDefinition.mockResolvedValue(agreementDefinition);
  });

  it("loads by Agreement reference fields", async () => {
    await expect(
      loadCurrentAgreementContextByReference(request),
    ).resolves.toEqual({ currentAgreement, agreementDefinition });

    expect(loadCurrentAgreement).toHaveBeenCalledWith(request);
    expect(loadCurrentAgreementByItem).not.toHaveBeenCalled();
    expect(loadAgreementDefinition).toHaveBeenCalledWith({
      code: currentAgreement.code,
      configVersion: currentAgreement.configVersion,
    });
  });

  it("loads the Current Agreement by its Agreement and Item IDs", async () => {
    const itemRequest = {
      agreementNumber: "PMF823153883",
      agreementItemId: "29b829c4-4e38-405c-9f00-427ee94120a5",
      session: { id: "session" },
    };

    await expect(
      loadCurrentAgreementContextByItem(itemRequest),
    ).resolves.toEqual({ currentAgreement, agreementDefinition });

    expect(loadCurrentAgreementByItem).toHaveBeenCalledWith(itemRequest);
    expect(loadCurrentAgreement).not.toHaveBeenCalled();
    expect(loadAgreementDefinition).toHaveBeenCalledWith({
      code: currentAgreement.code,
      configVersion: currentAgreement.configVersion,
    });
  });
});
