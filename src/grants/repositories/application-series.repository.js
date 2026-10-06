import Boom from "@hapi/boom";
import { config } from "../../common/config.js";
import { db } from "../../common/mongo-client.js";
import { ApplicationSeries } from "../models/application-series.js";

const collection = "application_series";

export const save = async (series, session) => {
  const document = series.toDocument();
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
      `Application_series with currentClientRef "${clientRef}" and code "${code}" not found.`,
    );
  }

  return ApplicationSeries.fromDocument(doc);
};

export const update = async (series, session) => {
  const document = series.toDocument();
  const result = await db
    .collection(collection)
    .replaceOne({ _id: series._id }, document, { session });
  if (result.modifiedCount === 0) {
    throw Boom.notFound(
      `Failed to update application_series with _id "${series._id}"`,
    );
  }
  return result;
};

// Every series holding any of the refs, under the one grant when it is named.
export const findSeriesByClientRefs = async (clientRefs, code) => {
  const docs = await db
    .collection(collection)
    .find(
      { clientRefs: { $in: clientRefs }, ...(code ? { code } : {}) },
      { maxTimeMS: config.adminReadTimeoutMs },
    )
    .toArray();

  return docs.map((doc) => ApplicationSeries.fromDocument(doc));
};
