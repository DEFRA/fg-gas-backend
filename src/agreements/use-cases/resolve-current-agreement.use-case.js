import Boom from "@hapi/boom";
import {
  findByClientRefCodeAndSbi,
  findLatestVersionByAgreementNumber,
} from "../repositories/agreement.repository.js";

const requireAgreementIdentity = (agreement, identity) => {
  if (!agreement) {
    throw Boom.notFound("Agreement not found");
  }

  const completeIdentity = {
    agreementNumber: agreement.agreementNumber,
    ...identity,
  };

  if (!agreement.findItemForIdentity(completeIdentity)) {
    throw Boom.notFound("Agreement not found");
  }

  return completeIdentity;
};

const requireVersion = (version, agreementNumber) => {
  if (!version) {
    throw Boom.badImplementation(
      `Agreement "${agreementNumber}" has no recorded version`,
    );
  }

  return version;
};

const requireSnapshotItem = (version, identity) => {
  const item = version.snapshot?.findItemForIdentity?.(identity);

  if (!item) {
    throw Boom.badImplementation(
      `Agreement "${identity.agreementNumber}" latest version is inconsistent`,
    );
  }

  return item;
};

export const resolveCurrentAgreementByIdentity = async ({
  code,
  clientRef,
  sbi,
}) => {
  const identity = requireAgreementIdentity(
    await findByClientRefCodeAndSbi(clientRef, code, sbi),
    { code, clientRef, sbi },
  );
  const version = requireVersion(
    await findLatestVersionByAgreementNumber(identity.agreementNumber),
    identity.agreementNumber,
  );
  const item = requireSnapshotItem(version, identity);

  return { identity, version, item };
};
