import Boom from "@hapi/boom";
import { AgreementAction } from "../models/agreement-action.js";
import { resolveAgreementActionForVersion } from "../models/agreement-definitions/agreement-definition-resolver.js";
import { renderAgreementPageFromVersionUseCase } from "./render-agreement-page-from-version.use-case.js";
import { resolveCurrentAgreementUseCase } from "./resolve-current-agreement.use-case.js";

const requireMatchingAgreementNumber = (reference, agreementNumber) => {
  if (reference.agreementNumber !== agreementNumber) {
    throw Boom.notFound("Agreement not found");
  }
};

const isUnknownActionError = (error) =>
  Boom.isBoom(error) &&
  error.output.statusCode === 404 &&
  error.message.startsWith("Unknown action");

const resolveActionDefinition = (options) => {
  try {
    return resolveAgreementActionForVersion(options);
  } catch (error) {
    if (isUnknownActionError(error)) {
      throw Boom.conflict(error.message);
    }

    throw error;
  }
};

export const invokeAgreementActionUseCase = async ({
  agreementNumber,
  actionName,
  payload,
}) => {
  const { code, clientRef, sbi } = payload;
  const currentAgreement = await resolveCurrentAgreementUseCase({
    code,
    clientRef,
    sbi,
  });
  const { reference, item } = currentAgreement;
  requireMatchingAgreementNumber(reference, agreementNumber);

  const actionDefinition = resolveActionDefinition({
    code: reference.code,
    state: item.status,
    action: actionName,
    configVersion: item.configVersion,
  });
  const action = new AgreementAction({
    from: item.status,
    name: actionName,
    ...actionDefinition,
  });
  const validation = action.validate(payload);

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
