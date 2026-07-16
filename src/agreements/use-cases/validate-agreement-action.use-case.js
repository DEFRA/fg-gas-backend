import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { loadCurrentAgreementActionContext } from "./load-current-agreement-action-context.js";

export const validateAgreementActionUseCase = async ({
  actionName,
  reference: { agreementNumber, code, clientRef, sbi },
  values,
}) => {
  const { action, currentAgreement, agreementDefinition } =
    await loadCurrentAgreementActionContext({
      actionName,
      agreementNumber,
      code,
      clientRef,
      sbi,
    });
  const validation = action.validate(values);

  if (!validation.valid) {
    const pageModel = await buildAgreementPageModel({
      currentAgreement,
      agreementDefinition,
      page: validation.page,
      mode: "view",
    });

    return { ...pageModel, values, errors: validation.errors };
  }

  return { valid: true, transition: action.transition };
};
