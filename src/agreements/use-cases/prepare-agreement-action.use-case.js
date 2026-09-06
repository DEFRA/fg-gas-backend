import Boom from "@hapi/boom";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { loadCurrentAgreementActionContext } from "./load-current-agreement-action-context.js";
import { loadAgreementForAction } from "./load-current-agreement.js";

export const prepareAgreementActionUseCase = async ({
  actionName,
  agreementNumber,
  access,
}) => {
  const authorisedAgreement = await loadAgreementForAction({
    agreementNumber,
    access,
  });
  const { action, agreement, agreementDefinition, etag } =
    await loadCurrentAgreementActionContext({
      actionName,
      agreement: authorisedAgreement,
      agreementNumber,
    });
  if (!action.preparationPage) {
    throw Boom.badImplementation(
      `Agreement action "${actionName}" has no configured preparation page`,
    );
  }

  const pageModel = await buildAgreementPageModel({
    agreement,
    agreementDefinition,
    page: action.preparationPage,
    mode: "view",
  });

  return { pageModel, etag };
};
