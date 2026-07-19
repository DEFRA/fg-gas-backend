import Boom from "@hapi/boom";
import { InvalidAgreementTransitionError } from "../models/invalid-agreement-transition.error.js";
import { loadCurrentAgreementContextByItem } from "./load-current-agreement-context.js";

export const resolveAgreementAction = (agreementDefinition, options) => {
  try {
    return agreementDefinition.resolveAction(options);
  } catch (error) {
    if (error instanceof InvalidAgreementTransitionError) {
      throw Boom.conflict(error.message);
    }

    throw error;
  }
};

export const loadCurrentAgreementActionContext = async ({
  actionName,
  agreementNumber,
  agreementItemId,
  session,
}) => {
  const { currentAgreement, agreementDefinition } =
    await loadCurrentAgreementContextByItem({
      agreementNumber,
      agreementItemId,
      ...(session ? { session } : {}),
    });

  const action = resolveAgreementAction(agreementDefinition, {
    state: currentAgreement.state,
    action: actionName,
  });

  return { action, agreementDefinition, currentAgreement };
};
