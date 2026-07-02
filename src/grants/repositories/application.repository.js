import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { db } from "../../common/mongo-client.js";
import { Agreement, AgreementHistoryEntry } from "../models/agreement.js";
import { ApplicationDocument } from "../models/application-document.js";
import { Application } from "../models/application.js";

const legacyConfigVersion = (doc) => doc.configVersion ?? null;

const configVersionsFromDoc = (doc) => {
  const legacy = legacyConfigVersion(doc);
  return {
    originalConfigVersion: doc.originalConfigVersion ?? legacy,
    currentConfigVersion: doc.currentConfigVersion ?? legacy,
  };
};

const toAgreement = (value) => {
  const history = value.history.map(
    (entry) => new AgreementHistoryEntry(entry),
  );
  return new Agreement({ ...value, history });
};

const toAgreements = (agreements) =>
  Object.entries(agreements ?? {}).reduce((acc, [key, value]) => {
    acc[key] = toAgreement(value);
    return acc;
  }, {});

const toApplication = (doc) =>
  new Application({
    currentPhase: doc.currentPhase,
    currentStage: doc.currentStage,
    currentStatus: doc.currentStatus,
    clientRef: doc.clientRef,
    code: doc.code,
    ...configVersionsFromDoc(doc),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    submittedAt: doc.submittedAt,
    identifiers: doc.identifiers ?? {},
    metadata: doc.metadata ?? {},
    phases: doc.phases,
    agreements: toAgreements(doc.agreements),
  });

export const collection = "applications";

export const save = async (application, session) => {
  const document = new ApplicationDocument(application);

  try {
    const result = await db
      .collection(collection)
      .insertOne(document, { session });
    return result;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw Boom.conflict(
        `Application with clientRef "${application.clientRef}" exists`,
      );
    }

    throw error;
  }
};

export const update = async (application, session) => {
  const document = new ApplicationDocument(application);
  const result = await db.collection(collection).replaceOne(
    {
      clientRef: application.clientRef,
      code: application.code,
    },
    document,
    { session },
  );
  if (result.modifiedCount === 0) {
    throw Boom.notFound(
      `Failed to update application with clientRef "${application.clientRef}" and code "${application.code}"`,
    );
  }
};

export const findByClientRefAndCode = async ({ clientRef, code }, session) => {
  const doc = await db
    .collection(collection)
    .findOne({ clientRef, code }, { session });

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

export const updateCurrentConfigVersion = async (clientRef, code, version) => {
  await db
    .collection(collection)
    .updateOne(
      { clientRef, code },
      { $set: { currentConfigVersion: version } },
    );
};
