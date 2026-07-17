import Boom from "@hapi/boom";
import { CurrentAgreement } from "../models/current-agreement.js";
import {
  findByAgreementNumber,
  findByClientRefCodeAndSbi,
  findLatestVersionByAgreementNumber,
} from "../repositories/agreement.repository.js";

const AGREEMENT_NOT_FOUND_MESSAGE = "Agreement not found";

const requireAgreementReference = (agreement, query) => {
  if (!agreement) {
    throw Boom.notFound(AGREEMENT_NOT_FOUND_MESSAGE);
  }

  const reference = agreement.resolveReference(query);

  if (!reference) {
    throw Boom.notFound(AGREEMENT_NOT_FOUND_MESSAGE);
  }

  return reference;
};

const requireVersion = (version, agreementNumber) => {
  if (!version) {
    throw Boom.badImplementation(
      `Agreement "${agreementNumber}" has no recorded version`,
    );
  }

  return version;
};

const loadCurrentAgreementVersion = async ({ reference, session }) => {
  const version = requireVersion(
    await findLatestVersionByAgreementNumber(
      reference.agreementNumber,
      session,
    ),
    reference.agreementNumber,
  );

  return new CurrentAgreement({ reference, version });
};

export const loadCurrentAgreement = async ({
  code,
  clientRef,
  sbi,
  session,
}) => {
  const reference = requireAgreementReference(
    await findByClientRefCodeAndSbi(clientRef, code, sbi, session),
    { code, clientRef, sbi },
  );

  return loadCurrentAgreementVersion({ reference, session });
};

export const loadCurrentAgreementByItem = async ({
  agreementNumber,
  agreementItemId,
  session,
}) => {
  const agreement = await findByAgreementNumber(agreementNumber, session);

  if (!agreement) {
    throw Boom.notFound(AGREEMENT_NOT_FOUND_MESSAGE);
  }

  const reference = agreement.resolveItemReference(agreementItemId);

  if (!reference) {
    throw Boom.notFound(AGREEMENT_NOT_FOUND_MESSAGE);
  }

  return loadCurrentAgreementVersion({ reference, session });
};
