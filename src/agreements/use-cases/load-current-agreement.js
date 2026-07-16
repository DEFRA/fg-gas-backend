import Boom from "@hapi/boom";
import { CurrentAgreement } from "../models/current-agreement.js";
import {
  findByAgreementNumber,
  findByClientRefCodeAndSbi,
  findLatestVersionByAgreementNumber,
} from "../repositories/agreement.repository.js";

const requireAgreementReference = (agreement, query) => {
  if (!agreement) {
    throw Boom.notFound("Agreement not found");
  }

  const reference = agreement.resolveReference(query);

  if (!reference) {
    throw Boom.notFound("Agreement not found");
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
    throw Boom.notFound("Agreement not found");
  }

  const reference = agreement.resolveItemReference(agreementItemId);

  if (!reference) {
    throw Boom.notFound("Agreement not found");
  }

  return loadCurrentAgreementVersion({ reference, session });
};
