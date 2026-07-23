import Boom from "@hapi/boom";
import { AgreementReference } from "../models/agreement-reference.js";

export const assertCurrentAgreementReference = (
  currentAgreement,
  { agreementNumber, code, clientRef, sbi },
) => {
  if (!agreementNumber) {
    return;
  }

  const requestedReference = new AgreementReference({
    agreementNumber,
    code,
    clientRef,
    sbi,
  });

  if (!currentAgreement.matchesReference(requestedReference)) {
    throw Boom.notFound("Agreement not found");
  }
};
