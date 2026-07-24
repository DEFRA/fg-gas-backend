import { db } from "../../common/mongo-client.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";

export const agreementsCollection = "agreements__agreements";
export const versionsCollection = "agreements__versions";

const toCurrentDocument = (agreement) => ({
  _id: agreement.agreementNumber,
  ...structuredClone(agreement),
});

const toVersionDocument = (agreementVersion) => ({
  agreementNumber: agreementVersion.agreementNumber,
  version: agreementVersion.version,
  snapshot: structuredClone(agreementVersion.snapshot),
  versionedAt: agreementVersion.versionedAt,
  ...(agreementVersion.actionExecution
    ? { actionExecution: agreementVersion.actionExecution }
    : {}),
});

export const findAgreementByNumber = async (agreementNumber, session) => {
  const document = await db
    .collection(agreementsCollection)
    .findOne({ _id: agreementNumber }, { session });

  return document ? new Agreement(document) : null;
};

export const findAgreementBySourceIdentity = async (
  { code, clientRef },
  session,
) => {
  const document = await db
    .collection(agreementsCollection)
    .findOne({ code, clientRef }, { session });

  return document ? new Agreement(document) : null;
};

export const insertCurrentAgreement = async (agreement, session) =>
  db
    .collection(agreementsCollection)
    .insertOne(toCurrentDocument(agreement), { session });

export const insertAgreementVersion = async (agreementVersion, session) =>
  db
    .collection(versionsCollection)
    .insertOne(toVersionDocument(agreementVersion), { session });

export const replaceCurrentAgreement = async (
  agreement,
  expectedVersion,
  session,
) =>
  db
    .collection(agreementsCollection)
    .replaceOne(
      { _id: agreement.agreementNumber, version: expectedVersion },
      toCurrentDocument(agreement),
      { session },
    );

export const findVersionByIdempotencyKey = async (
  agreementNumber,
  idempotencyKey,
  session,
) => {
  const document = await db.collection(versionsCollection).findOne(
    {
      agreementNumber,
      "actionExecution.idempotencyKey": idempotencyKey,
    },
    { session },
  );

  return document ? new AgreementVersion(document) : null;
};
