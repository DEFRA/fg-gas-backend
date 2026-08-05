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

const isMatchingDocumentAccess = (agreement, access) =>
  agreement.code === access.code &&
  (access.source === "entra" ||
    (access.source === "defra" && agreement.identifiers.sbi === access.sbi));

const assertDocumentAccess = (agreement, access) =>
  requireAgreement(isMatchingDocumentAccess(agreement, access) && agreement);

const assertActionAccess = (agreement, access) =>
  requireAgreement(
    access.source === "defra" &&
      isMatchingDocumentAccess(agreement, access) &&
      agreement,
  );

const loadAgreementWithAccess = async ({
  agreementNumber,
  access,
  assertAccess,
  session,
}) =>
  assertAccess(
    await loadCurrentAgreementByNumber({ agreementNumber, session }),
    access,
  );

export const loadAgreementDocument = async (options) =>
  loadAgreementWithAccess({ ...options, assertAccess: assertDocumentAccess });

export const loadAgreementForAction = async (options) =>
  loadAgreementWithAccess({ ...options, assertAccess: assertActionAccess });
