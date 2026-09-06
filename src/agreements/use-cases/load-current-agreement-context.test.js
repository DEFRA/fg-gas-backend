import { expect, it, vi } from "vitest";
import { loadDefinitionForAgreement } from "./load-agreement-definition.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";
import { loadCurrentAgreementByNumber } from "./load-current-agreement.js";

vi.mock("./load-agreement-definition.js");
vi.mock("./load-current-agreement.js");

it("returns the loaded Agreement with the definition it resolves to", async () => {
  const agreement = {
    agreementNumber: "PMF823153883",
    code: "pigs-might-fly",
    configVersion: "1.0.1",
    version: 1,
  };
  const agreementDefinition = { configVersion: "1.2.0" };
  loadCurrentAgreementByNumber.mockResolvedValue(agreement);
  loadDefinitionForAgreement.mockResolvedValue(agreementDefinition);

  await expect(
    loadCurrentAgreementContext({
      agreementNumber: agreement.agreementNumber,
    }),
  ).resolves.toEqual({
    agreement,
    agreementDefinition,
    etag: '"PMF823153883:1:1.2.0"',
  });
  expect(loadDefinitionForAgreement).toHaveBeenCalledWith(agreement);
});
