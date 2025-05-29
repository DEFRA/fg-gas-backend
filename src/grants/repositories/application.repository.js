import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { db } from "../../common/mongo-client.js";
import { ApplicationDocument } from "../models/application-document.js";
import { Application } from "../models/application.js";

const toApplication = (doc) =>
  new Application({
    clientRef: doc.clientRef,
    code: doc.code,
    createdAt: doc.createdAt,
    submittedAt: doc.submittedAt,
    identifiers: {
      sbi: doc.identifiers.sbi,
      frn: doc.identifiers.frn,
      crn: doc.identifiers.crn,
      defraId: doc.identifiers.defraId,
    },
    answers: doc.answers,
  });

export const collection = "applications";

export const save = async (application) => {
  const document = new ApplicationDocument(application);

  try {
    await db.collection(collection).insertOne(document);
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw Boom.conflict(
        `Application with clientRef "${application.clientRef}" exists`,
      );
    }

    throw error;
  }
};

export const findByClientRef = async (clientRef) => {
  const application = await db.collection(collection).findOne({ clientRef });

  if (application === null) {
    return null;
  }

  return toApplication(application);
};
