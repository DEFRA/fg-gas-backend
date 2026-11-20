import { db } from "../../common/mongo-client.js";
import { DbReferenceData } from "../models/db-reference-data.js";

const collection = "reference_data";

const sessionOptions = (session) => (session ? { session } : {});

export const findByGrantCodeAndName = async (grantCode, name, session) => {
  const document = await db
    .collection(collection)
    .findOne({ grantCode, name }, sessionOptions(session));

  return document ? DbReferenceData.fromDocument(document) : null;
};

export const findByGrantCode = async (grantCode) => {
  const documents = await db
    .collection(collection)
    .find({ grantCode })
    .toArray();

  return documents.map((document) => DbReferenceData.fromDocument(document));
};

export const replace = async (referenceData, session) => {
  await db
    .collection(collection)
    .replaceOne(
      { grantCode: referenceData.grantCode, name: referenceData.name },
      referenceData.toDocument(),
      { upsert: true, ...sessionOptions(session) },
    );
};
