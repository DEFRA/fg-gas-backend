import { db } from "../../common/mongo-client.js";
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
