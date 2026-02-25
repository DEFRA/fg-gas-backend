import Boom from "@hapi/boom";
import { db } from "../../common/mongo-client.js";

const collection = "application_xref";

export const save = async (xref, session) => {
  const document = xref.toDocument();
  const result = await db
    .collection(collection)
    .insertOne(document, { session });
  return result;
};

export const update = async (xref, session) => {
  const document = xref.toDocument();
  const result = await db
    .collection(collection)
    .updateOne({ _id: xref._id }, document, { session });
  if (result.modifiedCount === 0) {
    throw Boom.notFound(
      `Failed to update application_xref with _id "${xref._id}"`,
    );
  }
  return result;
};
