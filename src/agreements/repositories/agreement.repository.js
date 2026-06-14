import { db } from "../../common/mongo-client.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";

const collection = "agreements";
const versionsCollection = "agreement_versions";

export const findAgreementBySourceIdentity = async (
  { agreementCode, clientRef },
  session,
) => {
  const doc = await db.collection(collection).findOne(
    {
      items: {
        $elemMatch: {
          agreementCode,
          clientRef,
        },
      },
    },
    { session },
  );

  return doc ? Agreement.fromDocument(doc) : null;
};

export const findAgreementByExternalItemIdentity = async (
  { agreementNumber, agreementCode, clientRef },
  session,
) => {
  const doc = await db.collection(collection).findOne(
    {
      agreementNumber,
      items: {
        $elemMatch: {
          agreementCode,
          clientRef,
        },
      },
    },
    { session },
  );

  return doc ? Agreement.fromDocument(doc) : null;
};

export const findAgreementById = async (agreementId, session) => {
  const doc = await db.collection(collection).findOne(
    {
      _id: agreementId,
    },
    { session },
  );

  return doc ? Agreement.fromDocument(doc) : null;
};

export const findAgreementByItemId = async (agreementItemId, session) => {
  const doc = await db.collection(collection).findOne(
    {
      "items.agreementItemId": agreementItemId,
    },
    { session },
  );

  return doc ? Agreement.fromDocument(doc) : null;
};

export const findLatestAgreementVersion = async (agreementId, session) => {
  const doc = await db.collection(versionsCollection).findOne(
    {
      agreementId,
    },
    {
      sort: { version: -1 },
      session,
    },
  );

  return doc ? new AgreementVersion(doc) : null;
};

export const findAgreementWithLatestVersionByExternalItemIdentity = async (
  identity,
  session,
) => {
  const agreement = await findAgreementByExternalItemIdentity(
    identity,
    session,
  );

  if (!agreement) {
    return null;
  }

  return {
    agreement,
    version: await findLatestAgreementVersion(agreement.id, session),
  };
};

export const insertAgreementWithVersion = async (
  { agreement, version },
  session,
) => {
  await db.collection(collection).insertOne(agreement.toDocument(), {
    session,
  });
  await db.collection(versionsCollection).insertOne(version.toDocument(), {
    session,
  });

  return agreement;
};

export const insertAgreementVersion = async (version, session) => {
  await db.collection(versionsCollection).insertOne(version.toDocument(), {
    session,
  });
};

export const isAgreementNumberCollision = (error) =>
  isDuplicateKeyError(error) && isAgreementNumberIndex(error);

export const isSourceIdentityCollision = (error) =>
  isDuplicateKeyError(error) && isSourceIdentityIndex(error);

const isDuplicateKeyError = (error = {}) => error.code === 11000;

const isAgreementNumberIndex = ({ keyPattern = {} } = {}) =>
  keyPattern.agreementNumber === 1;

const isSourceIdentityIndex = ({ keyPattern = {} } = {}) =>
  keyPattern["items.clientRef"] === 1 &&
  keyPattern["items.agreementCode"] === 1;
