import Boom from "@hapi/boom";
import { InvalidAgreementTransitionError } from "../models/invalid-agreement-transition.error.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";

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

export const loadCurrentAgreementActionContext = async ({
  actionName,
  agreementNumber,
  code,
  clientRef,
  sbi,
}) => {
  const { currentAgreement, agreementDefinition } =
    await loadCurrentAgreementContext({ code, clientRef, sbi });
  requireMatchingAgreementNumber(currentAgreement.reference, agreementNumber);

  const action = resolveAgreementAction(agreementDefinition, {
    state: currentAgreement.state,
    action: actionName,
  });

  return { action, agreementDefinition, currentAgreement };
};
