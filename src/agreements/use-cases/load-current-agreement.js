import Boom from "@hapi/boom";
import { CurrentAgreement } from "../models/current-agreement.js";
import {
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

export const loadCurrentAgreement = async ({ code, clientRef, sbi }) => {
  const reference = requireAgreementReference(
    await findByClientRefCodeAndSbi(clientRef, code, sbi),
    { code, clientRef, sbi },
  );
  const version = requireVersion(
    await findLatestVersionByAgreementNumber(reference.agreementNumber),
    reference.agreementNumber,
  );

  return new CurrentAgreement({ reference, version });
};
