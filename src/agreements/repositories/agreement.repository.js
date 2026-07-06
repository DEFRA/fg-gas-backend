import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { db } from "../../common/mongo-client.js";
import { AgreementItem } from "../models/agreement-item.js";
import { Agreement } from "../models/agreement.js";
import { AgreementDocument } from "./agreement/agreement-document.js";
import { AgreementVersionDocument } from "./agreement/agreement-version-document.js";

export const toAgreement = (doc) =>
  new Agreement({
    id: doc._id,
    agreementNumber: doc.agreementNumber,
    code: doc.code,
    identifiers: doc.identifiers,
    items: (doc.items ?? []).map((item) => new AgreementItem(item)),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  });

export const agreementsCollection = "agreements__agreements";
export const versionsCollection = "agreements__versions";

const throwOnDuplicateKey = (error, agreementNumber) => {
  if (error.keyPattern?.agreementNumber) {
    throw Boom.conflict(
      `Agreement with number "${agreementNumber}" already exists`,
    );
  }
  throw Boom.conflict(
    "Agreement item with the same source identity already exists",
  );
};

export const saveAgreement = async (agreement, session) => {
  try {
    await db
      .collection(agreementsCollection)
      .insertOne(new AgreementDocument(agreement), { session });
  } catch (error) {
    const MONGO_DUPLICATE_KEY_ERROR = 11000;
    if (
      error instanceof MongoServerError &&
      error.code === MONGO_DUPLICATE_KEY_ERROR
    ) {
      throwOnDuplicateKey(error, agreement.agreementNumber);
    }
    throw error;
  }
};

export const saveVersion = async (version, session) => {
  await db
    .collection(versionsCollection)
    .insertOne(new AgreementVersionDocument(version), { session });
};

export const findByAgreementNumber = async (agreementNumber) => {
  const doc = await db
    .collection(agreementsCollection)
    .findOne({ agreementNumber });

  if (doc === null) {
    return null;
  }

  return toAgreement(doc);
};

export const findByClientRefAndCode = async (clientRef, code, session) => {
  const doc = await db
    .collection(agreementsCollection)
    .findOne(
      { "items.clientRef": clientRef, "items.agreementCode": code },
      { session },
    );

  if (doc === null) {
    return null;
  }

  return toAgreement(doc);
};
