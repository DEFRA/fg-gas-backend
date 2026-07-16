import Boom from "@hapi/boom";
import { loadAgreementDefinition } from "../models/agreement-definitions/agreement-definition-loader.js";
import { InvalidAgreementTransitionError } from "../models/invalid-agreement-transition.error.js";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { loadCurrentAgreement } from "./load-current-agreement.js";

const requireMatchingAgreementNumber = (reference, agreementNumber) => {
  if (reference.agreementNumber !== agreementNumber) {
    throw Boom.notFound("Agreement not found");
  }
};

const resolveAgreementAction = (agreementDefinition, options) => {
  try {
    return agreementDefinition.resolveAction(options);
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
  const currentAgreement = await loadCurrentAgreement({
    code,
    clientRef,
    sbi,
  });
  requireMatchingAgreementNumber(currentAgreement.reference, agreementNumber);

  const agreementDefinition = await loadAgreementDefinition({
    code: currentAgreement.code,
    configVersion: currentAgreement.definitionVersion,
  });
  const action = resolveAgreementAction(agreementDefinition, {
    state: currentAgreement.state,
    action: actionName,
  });
  const validation = action.validate(values);

  if (!validation.valid) {
    const pageModel = await buildAgreementPageModel({
      currentAgreement,
      agreementDefinition,
      page: validation.page,
      mode: "view",
    });

    return { ...pageModel, errors: validation.errors };
  }

  return { valid: true, transition: action.transition };
};
