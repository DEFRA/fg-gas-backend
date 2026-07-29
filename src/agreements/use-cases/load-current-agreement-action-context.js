import Boom from "@hapi/boom";
import { InvalidAgreementTransitionError } from "../models/invalid-agreement-transition.error.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";

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
  session,
}) => {
  const { agreement, agreementDefinition } = await loadCurrentAgreementContext({
    agreementNumber,
    session,
  });
  const action = resolveAgreementAction(agreementDefinition, {
    state: agreement.state,
    action: actionName,
  });

  return { action, agreement, agreementDefinition };
};
