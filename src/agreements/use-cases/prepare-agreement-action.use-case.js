import Boom from "@hapi/boom";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { loadCurrentAgreementActionContext } from "./load-current-agreement-action-context.js";

export const prepareAgreementActionUseCase = async ({
  actionName,
  agreementNumber,
  agreementItemId,
}) => {
  const { action, currentAgreement, agreementDefinition } =
    await loadCurrentAgreementActionContext({
      actionName,
      agreementNumber,
      agreementItemId,
    });
  const page = action.preparationPage;

  if (!page) {
    throw Boom.badImplementation(
      `Agreement action "${actionName}" has no configured preparation page`,
    );
  }

  return buildAgreementPageModel({
    currentAgreement,
    agreementDefinition,
    page,
    mode: "view",
  });
};
