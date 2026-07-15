import Boom from "@hapi/boom";
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

const requireSnapshotItem = (version, reference) => {
  const item = version.snapshot?.findItem?.(reference);

  if (!item) {
    throw Boom.badImplementation(
      `Agreement "${reference.agreementNumber}" latest version is inconsistent`,
    );
  }

  return item;
};

export const resolveCurrentAgreementUseCase = async ({
  code,
  clientRef,
  sbi,
}) => {
  const reference = requireAgreementReference(
    await findByClientRefCodeAndSbi(clientRef, code, sbi),
    { code, clientRef, sbi },
  );
  const version = requireVersion(
    await findLatestVersionByAgreementNumber(reference.agreementNumber),
    reference.agreementNumber,
  );
  const item = requireSnapshotItem(version, reference);

  return { reference, version, item };
};
