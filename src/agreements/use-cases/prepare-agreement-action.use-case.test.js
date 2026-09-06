import { describe, expect, it, vi } from "vitest";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { loadCurrentAgreementActionContext } from "./load-current-agreement-action-context.js";
import { loadAgreementForAction } from "./load-current-agreement.js";
import { prepareAgreementActionUseCase } from "./prepare-agreement-action.use-case.js";

vi.mock("../services/build-agreement-page-model.js");
vi.mock("./load-current-agreement-action-context.js");
vi.mock("./load-current-agreement.js");

describe("prepareAgreementActionUseCase", () => {
  it("builds the configured preparation page for one Agreement", async () => {
    const agreement = { agreementNumber: "PMF123" };
    const agreementDefinition = {};
    loadAgreementForAction.mockResolvedValue(agreement);
    loadCurrentAgreementActionContext.mockResolvedValue({
      action: { preparationPage: "accept" },
      agreement,
      agreementDefinition,
    });
    buildAgreementPageModel.mockResolvedValue({ agreement: {} });

    await prepareAgreementActionUseCase({
      agreementNumber: "PMF123",
      actionName: "accept",
      access: {
        source: "defra",
        code: "pigs-might-fly",
        sbi: "300000000",
      },
    });

    expect(loadAgreementForAction).toHaveBeenCalledWith({
      agreementNumber: "PMF123",
      access: {
        source: "defra",
        code: "pigs-might-fly",
        sbi: "300000000",
      },
    });
    expect(loadCurrentAgreementActionContext).toHaveBeenCalledWith({
      agreement,
      agreementNumber: "PMF123",
      actionName: "accept",
    });

    expect(buildAgreementPageModel).toHaveBeenCalledWith({
      agreement,
      agreementDefinition,
      page: "accept",
      mode: "view",
    });
  });

  it("rejects an action without a preparation page", async () => {
    loadAgreementForAction.mockResolvedValue({ agreementNumber: "PMF123" });
    loadCurrentAgreementActionContext.mockResolvedValue({
      action: {},
      agreement: {},
      agreementDefinition: {},
    });

    await expect(
      prepareAgreementActionUseCase({
        agreementNumber: "PMF123",
        actionName: "accept",
        access: {
          source: "defra",
          code: "pigs-might-fly",
          sbi: "300000000",
        },
      }),
    ).rejects.toMatchObject({ output: { statusCode: 500 } });
  });
});
