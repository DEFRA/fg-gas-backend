import Boom from "@hapi/boom";
import {
  findAgreementByNumber,
  findAgreementBySourceIdentity,
} from "../repositories/agreement.repository.js";

const requireAgreement = (agreement) => {
  if (!agreement) {
    throw Boom.notFound("Agreement not found");
  }
  return agreement;
};

const assertSbi = (agreement, sbi) => {
  if (agreement.identifiers.sbi !== sbi) {
    throw Boom.notFound("Agreement not found");
  }
  return agreement;
};

export const loadCurrentAgreement = async ({ code, clientRef, sbi, session }) =>
  assertSbi(
    requireAgreement(
      await findAgreementBySourceIdentity({ code, clientRef }, session),
    ),
    sbi,
  );

export const loadCurrentAgreementByNumber = async ({
  agreementNumber,
  session,
}) => requireAgreement(await findAgreementByNumber(agreementNumber, session));

export const loadAgreementDocument = async ({
  agreementNumber,
  code,
  clientRef,
  sbi,
  session,
}) => {
  const agreement = await loadCurrentAgreementByNumber({
    agreementNumber,
    session,
  });
  const matchesReference =
    agreement.code === code &&
    agreement.clientRef === clientRef &&
    agreement.identifiers.sbi === sbi;

  return requireAgreement(matchesReference ? agreement : undefined);
};
