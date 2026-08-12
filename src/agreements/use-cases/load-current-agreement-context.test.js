import { describe, expect, it, vi } from "vitest";
import { loadAgreementDefinition } from "./load-agreement-definition.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";
import { loadCurrentAgreementByNumber } from "./load-current-agreement.js";

vi.mock("./load-agreement-definition.js");
vi.mock("./load-current-agreement.js");

describe("loadCurrentAgreementContext", () => {
  it("loads the definition version recorded by the Agreement", async () => {
    const agreement = {
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      configVersion: "1.0.1",
      version: 1,
    };
    const agreementDefinition = { configVersion: "1.2.0" };
    loadCurrentAgreementByNumber.mockResolvedValue(agreement);
    loadAgreementDefinition.mockResolvedValue(agreementDefinition);

    await expect(
      loadCurrentAgreementContext({
        agreementNumber: agreement.agreementNumber,
      }),
    ).resolves.toEqual({
      agreement,
      agreementDefinition,
      // ETag carries the resolved definition version, not the Agreement's.
      etag: '"PMF823153883:1:1.2.0"',
    });
    expect(loadAgreementDefinition).toHaveBeenCalledWith({
      code: agreement.code,
      configVersion: agreement.configVersion,
      resolution: "same-major",
    });
  });

  it("pins accepted Agreements to their exact definition", async () => {
    const agreement = {
      agreementNumber: "PMF823153883",
      code: "pigs-might-fly",
      configVersion: "1.2.0",
      state: "accepted",
    };
    loadAgreementDefinition.mockResolvedValue({ configVersion: "1.2.0" });

    await loadCurrentAgreementContext({ agreement });

    expect(loadAgreementDefinition).toHaveBeenCalledWith({
      code: agreement.code,
      configVersion: agreement.configVersion,
      resolution: "exact",
    });
  });
});
