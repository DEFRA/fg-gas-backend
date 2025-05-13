import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { db } from "../common/db.js";

const toDocument = (application) => ({
  clientRef: application.clientRef,
  code: application.code,
  createdAt: application.createdAt,
  submittedAt: application.submittedAt,
  identifiers: {
    sbi: application.identifiers.sbi,
    frn: application.identifiers.frn,
    crn: application.identifiers.crn,
    defraId: application.identifiers.defraId,
  },
  answers: application.answers,
});

export const collection = "applications";

export const add = async (application) => {
  const applicationDocument = toDocument(application);

  try {
    await db.collection(collection).insertOne(applicationDocument);
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw Boom.conflict(
        `Application with clientRef "${application.clientRef}" already exists`,
      );
    }

    throw Boom.internal(error);
  }
};

export const findByClientRef = async (clientRef) => {
  return await db.collection(collection).findOne({ clientRef });
};
