import { describe, expect, it, vi } from "vitest";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { getCurrentAgreementPageModelUseCase } from "./get-current-agreement-page-model.use-case.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";

vi.mock("../services/build-agreement-page-model.js");
vi.mock("./load-current-agreement-context.js");

describe("getCurrentAgreementPageModelUseCase", () => {
  it("renders the page for the Agreement lifecycle state", async () => {
    const agreement = {
      agreementNumber: "PMF123",
      state: "offered",
      version: 1,
    };
    const agreementDefinition = {
      resolvePageForState: vi.fn().mockReturnValue({ pageId: "offer" }),
    };
    const pageModel = { agreement: { agreementNumber: "PMF123" } };
    loadCurrentAgreementContext.mockResolvedValue({
      agreement,
      agreementDefinition,
    });
    buildAgreementPageModel.mockResolvedValue(pageModel);

    await expect(
      getCurrentAgreementPageModelUseCase({ agreementNumber: "PMF123" }),
    ).resolves.toEqual({ agreement, pageModel });
    expect(buildAgreementPageModel).toHaveBeenCalledWith({
      agreement,
      agreementDefinition,
      page: "offer",
      mode: "view",
    });
  });
});
