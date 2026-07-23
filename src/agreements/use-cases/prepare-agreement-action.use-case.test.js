import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { loadCurrentAgreementActionContext } from "./load-current-agreement-action-context.js";
import { prepareAgreementActionUseCase } from "./prepare-agreement-action.use-case.js";

vi.mock("../services/build-agreement-page-model.js");
vi.mock("./load-current-agreement-action-context.js");

const request = {
  actionName: "accept",
  agreementNumber: "PMF823153883",
  agreementItemId: "29b829c4-4e38-405c-9f00-427ee94120a5",
};

const currentAgreement = { state: "offered" };
const agreementDefinition = {};
const pageModel = {
  agreementNumber: request.agreementNumber,
  state: "offered",
  page: { name: "accept" },
  components: [],
  actions: [],
};

describe("prepareAgreementActionUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCurrentAgreementActionContext.mockResolvedValue({
      action: { preparationPage: "accept" },
      currentAgreement,
      agreementDefinition,
    });
    buildAgreementPageModel.mockResolvedValue(pageModel);
  });

  it("builds the configured action preparation page", async () => {
    await expect(prepareAgreementActionUseCase(request)).resolves.toEqual(
      pageModel,
    );

    expect(loadCurrentAgreementActionContext).toHaveBeenCalledWith(request);
    expect(buildAgreementPageModel).toHaveBeenCalledWith({
      currentAgreement,
      agreementDefinition,
      page: "accept",
      mode: "view",
    });
  });

  it("does not run writes or effects when repeated", async () => {
    await expect(
      Promise.all([
        prepareAgreementActionUseCase(request),
        prepareAgreementActionUseCase(request),
      ]),
    ).resolves.toEqual([pageModel, pageModel]);

    expect(loadCurrentAgreementActionContext).toHaveBeenCalledTimes(2);
    expect(buildAgreementPageModel).toHaveBeenCalledTimes(2);
  });

  it("rejects an action without a configured preparation page", async () => {
    loadCurrentAgreementActionContext.mockResolvedValue({
      action: { preparationPage: undefined },
      currentAgreement,
      agreementDefinition,
    });

    await expect(prepareAgreementActionUseCase(request)).rejects.toMatchObject({
      isBoom: true,
      message: 'Agreement action "accept" has no configured preparation page',
      output: { statusCode: 500 },
    });
    expect(buildAgreementPageModel).not.toHaveBeenCalled();
  });
});
