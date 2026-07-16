import Boom from "@hapi/boom";
import { InvalidAgreementTransitionError } from "../models/invalid-agreement-transition.error.js";
import { assertCurrentAgreementReference } from "./assert-current-agreement-reference.js";
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
  code,
  clientRef,
  sbi,
  session,
}) => {
  const { currentAgreement, agreementDefinition } =
    await loadCurrentAgreementContext({ code, clientRef, sbi, session });
  assertCurrentAgreementReference(currentAgreement, {
    agreementNumber,
    code,
    clientRef,
    sbi,
  });

  const action = resolveAgreementAction(agreementDefinition, {
    state: currentAgreement.state,
    action: actionName,
  });

  return { action, agreementDefinition, currentAgreement };
};
