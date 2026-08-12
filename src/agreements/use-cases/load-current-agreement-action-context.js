import Boom from "@hapi/boom";
import { InvalidAgreementTransitionError } from "../models/invalid-agreement-transition.error.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";

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

export const loadCurrentAgreementActionContext = async ({
  actionName,
  agreement,
  agreementNumber,
  session,
}) => {
  const context = await loadCurrentAgreementContext({
    agreement,
    agreementNumber,
    session,
  });
  const action = resolveAgreementAction(context.agreementDefinition, {
    state: context.agreement.state,
    action: actionName,
  });

  return { action, ...context };
};
