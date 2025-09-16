import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { db } from "../../common/mongo-client.js";
import { Agreement, AgreementHistoryEntry } from "../models/agreement.js";
import { ApplicationDocument } from "../models/application-document.js";
import { Application } from "../models/application.js";

const toApplication = (doc) =>
  new Application({
    currentPhase: doc.currentPhase,
    currentStage: doc.currentStage,
    currentStatus: doc.currentStatus,
    clientRef: doc.clientRef,
    code: doc.code,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    submittedAt: doc.submittedAt,
    identifiers: {
      sbi: doc.identifiers.sbi,
      frn: doc.identifiers.frn,
      crn: doc.identifiers.crn,
      defraId: doc.identifiers.defraId,
    },
    answers: doc.answers,
    agreements: Object.entries(doc.agreements).reduce((acc, [key, value]) => {
      const history = value.history.map(
        (entry) => new AgreementHistoryEntry(entry),
      );

      acc[key] = new Agreement({
        ...value,
        history,
      });

      return acc;
    }, {}),
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

export const update = async (application) => {
  const document = new ApplicationDocument(application);
  const result = await db.collection(collection).replaceOne(
    {
      clientRef: application.clientRef,
      code: application.code,
    },
    document,
  );
  if (result.modifiedCount === 0) {
    throw Boom.notFound(
      `Failed to update application with clientRef "${application.clientRef}" and code "${application.code}"`,
    );
  }
};

export const findByClientRefAndCode = async ({ clientRef, code }) => {
  const doc = await db.collection(collection).findOne({ clientRef, code });

  if (doc === null) {
    return null;
  }

  return doc && toApplication(doc);
};

export const findByClientRef = async (clientRef) => {
  const doc = await db.collection(collection).findOne({ clientRef });

  if (doc === null) {
    return null;
  }

  return toApplication(doc);
};
