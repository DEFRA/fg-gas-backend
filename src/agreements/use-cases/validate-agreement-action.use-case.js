import Boom from "@hapi/boom";
import { resolveAgreementActionForVersion } from "../models/agreement-definitions/agreement-definition-resolver.js";
import { InvalidAgreementTransitionError } from "../models/invalid-agreement-transition.error.js";
import { renderAgreementPageFromVersionUseCase } from "./render-agreement-page-from-version.use-case.js";
import { resolveCurrentAgreementUseCase } from "./resolve-current-agreement.use-case.js";

const requireMatchingAgreementNumber = (reference, agreementNumber) => {
  if (reference.agreementNumber !== agreementNumber) {
    throw Boom.notFound("Agreement not found");
  }
};

const resolveAgreementAction = (options) => {
  try {
    return resolveAgreementActionForVersion(options);
  } catch (error) {
    if (error instanceof InvalidAgreementTransitionError) {
      throw Boom.conflict(error.message);
    }

    throw error;
  }
};

export const validateAgreementActionUseCase = async ({
  agreementNumber,
  actionName,
  reference: { code, clientRef, sbi },
  values,
}) => {
  const currentAgreement = await resolveCurrentAgreementUseCase({
    code,
    clientRef,
    sbi,
  });
  const { reference, item } = currentAgreement;
  requireMatchingAgreementNumber(reference, agreementNumber);

  const action = resolveAgreementAction({
    code: reference.code,
    state: item.status,
    action: actionName,
    configVersion: item.configVersion,
  });
  const validation = action.validate(values);

  if (!validation.valid) {
    const renderModel = await renderAgreementPageFromVersionUseCase({
      currentAgreement,
      page: validation.page,
      mode: "view",
    });

    return { ...renderModel, errors: validation.errors };
  }

  return { valid: true, transition: action.transition };
};
