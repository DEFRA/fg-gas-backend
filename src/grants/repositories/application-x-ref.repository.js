import Boom from "@hapi/boom";
import { db } from "../../common/mongo-client.js";
import { ApplicationXRef } from "../models/application-x-ref.js";

const collection = "application_xref";

export const save = async (xref, session) => {
  const document = xref.toDocument();
  const result = await db
    .collection(collection)
    .insertOne(document, { session });
  return result;
};

export const findByClientRefAndCode = async (clientRef, code, session) => {
  const doc = await db
    .collection(collection)
    .findOne({ latestClientRef: clientRef, code }, { session });

  if (doc === null) {
    throw Boom.notFound(
      `Application_xref with currentClientRef "${clientRef}" and code "${code}" not found.`,
    );
  }

  return ApplicationXRef.fromDocument(doc);
};

export const update = async (xref, session) => {
  const document = xref.toDocument();
  const result = await db
    .collection(collection)
    .replaceOne({ _id: xref._id }, document, { session });
  if (result.modifiedCount === 0) {
    throw Boom.notFound(
      `Failed to update application_xref with _id "${xref._id}"`,
    );
  }
  return result;
};
