import Boom from "@hapi/boom";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { loadCurrentAgreementActionContext } from "./load-current-agreement-action-context.js";

export const prepareAgreementActionUseCase = async ({
  actionName,
  agreementNumber,
}) => {
  const { action, agreement, agreementDefinition } =
    await loadCurrentAgreementActionContext({ actionName, agreementNumber });
  if (!action.preparationPage) {
    throw Boom.badImplementation(
      `Agreement action "${actionName}" has no configured preparation page`,
    );
  }

  return buildAgreementPageModel({
    agreement,
    agreementDefinition,
    page: action.preparationPage,
    mode: "view",
  });
};
