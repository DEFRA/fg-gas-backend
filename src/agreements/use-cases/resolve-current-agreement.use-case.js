import Boom from "@hapi/boom";
import {
  findAgreementItem,
  findAgreementItemForIdentity,
} from "../models/agreement-identity.js";
import {
  findByClientRefCodeAndSbi,
  findLatestVersionByAgreementNumber,
} from "../repositories/agreement.repository.js";

const agreementMatchesIdentity = (agreement, { code, clientRef, sbi }) =>
  [
    agreement.code === code,
    agreement.identifiers?.sbi === sbi,
    Boolean(findAgreementItem(agreement.items, { code, clientRef })),
  ].every(Boolean);

const requireAgreement = (agreement, identity) => {
  if (!agreement || !agreementMatchesIdentity(agreement, identity)) {
    throw Boom.notFound("Agreement not found");
  }

  return agreement;
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
  const item = findAgreementItemForIdentity(version.snapshot, identity);

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
  const agreement = requireAgreement(
    await findByClientRefCodeAndSbi(clientRef, code, sbi),
    { code, clientRef, sbi },
  );
  const rootItem = findAgreementItem(agreement.items, { code, clientRef });
  const identity = {
    agreementNumber: agreement.agreementNumber,
    code: agreement.code,
    clientRef: rootItem.clientRef,
    sbi: agreement.identifiers.sbi,
  };
  const version = requireVersion(
    await findLatestVersionByAgreementNumber(identity.agreementNumber),
    identity.agreementNumber,
  );
  const item = requireSnapshotItem(version, identity);

  return { identity, version, item };
};
