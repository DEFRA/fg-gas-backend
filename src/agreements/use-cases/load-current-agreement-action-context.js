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

const assertCurrentAgreement = (ifMatch, etag) => {
  if (ifMatch === undefined || ifMatch === etag) {
    return;
  }

  const stale = Boom.preconditionFailed("Agreement version is stale");
  stale.output.headers.location = "/agreements/current";
  if (etag) {
    stale.output.headers.etag = etag;
  }
  throw stale;
};

export const loadCurrentAgreementActionContext = async ({
  actionName,
  agreement,
  agreementNumber,
  session,
  ifMatch,
}) => {
  const context = await loadCurrentAgreementContext({
    agreement,
    agreementNumber,
    session,
  });
  assertCurrentAgreement(ifMatch, context.etag);
  const action = resolveAgreementAction(context.agreementDefinition, {
    state: context.agreement.state,
    action: actionName,
  });

  return { action, ...context };
};
