import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { config } from "../../common/config.js";
import {
  cappedField,
  storedBytes,
} from "../../common/mongo/capped-projection.js";
import { db } from "../../common/mongo-client.js";
import { Agreement, AgreementHistoryEntry } from "../models/agreement.js";
import {
  ApplicationDocument,
  seriesRefs,
} from "../models/application-document.js";
import { Application } from "../models/application.js";

const orNull = (value) => value ?? null;

// Older documents carry only the single legacy `configVersion`.
const configVersionsFromDoc = (doc) => {
  const legacy = doc.configVersion ?? null;

  return {
    originalConfigVersion: doc.originalConfigVersion ?? legacy,
    currentConfigVersion: doc.currentConfigVersion ?? legacy,
  };
};

const isInstant = (value) =>
  value instanceof Date && !Number.isNaN(value.getTime());

// New submissions store submittedAt as a Date. Any other value is shown as
// stored, so one odd document never fails the page.
const toTimestamp = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  return isInstant(value) ? value.toISOString() : String(value);
};

const toPosition = (doc) => ({
  phase: orNull(doc.currentPhase),
  stage: orNull(doc.currentStage),
  status: orNull(doc.currentStatus),
});

const toIdentifiers = (identifiers) => ({
  sbi: orNull(identifiers?.sbi),
  frn: orNull(identifiers?.frn),
  crn: orNull(identifiers?.crn),
});

const toApplicationRow = (doc) => ({
  clientRef: doc.clientRef,
  code: doc.code,
  position: toPosition(doc),
  createdAt: doc.createdAt,
});

const toApplicationSummary = (doc) => ({
  clientRef: doc.clientRef,
  code: doc.code,
  position: toPosition(doc),
  ...configVersionsFromDoc(doc),
  submittedAt: toTimestamp(doc.submittedAt),
  createdAt: doc.createdAt,
  updatedAt: toTimestamp(doc.updatedAt),
  identifiers: toIdentifiers(doc.identifiers),
});

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
  const { refs, ...document } = new ApplicationDocument(application);
  const result = await db.collection(collection).updateOne(
    {
      clientRef: application.clientRef,
      code: application.code,
    },
    { $set: document, $addToSet: { refs: { $each: refs } } },
    { session },
  );
  if (result.modifiedCount === 0) {
    throw Boom.notFound(
      `Failed to update application with clientRef "${application.clientRef}" and code "${application.code}"`,
    );
  }
};

// Every member is found by any member's reference.
export const linkSeries = async ({ code, clientRefs }, session) => {
  await db
    .collection(collection)
    .updateMany(
      { code, clientRef: { $in: clientRefs } },
      { $addToSet: { refs: { $each: seriesRefs(clientRefs) } } },
      { session },
    );
};

export const findByClientRefAndCode = async ({ clientRef, code }, session) => {
  const doc = await db
    .collection(collection)
    .findOne({ clientRef, code }, { session });

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

export const lockForUpdate = async ({ clientRef, code }, session) => {
  const doc = await db
    .collection(collection)
    .findOneAndUpdate(
      { clientRef, code },
      { $inc: { claimSubmissionLockVersion: 1 } },
      { session, returnDocument: "after" },
    );

  if (doc === null) {
    return null;
  }

  return toApplication(doc);
};

const ROW_PROJECTION = {
  _id: 1,
  clientRef: 1,
  code: 1,
  currentPhase: 1,
  currentStage: 1,
  currentStatus: 1,
  createdAt: 1,
};

const SUMMARY_PROJECTION = {
  _id: 0,
  clientRef: 1,
  code: 1,
  currentPhase: 1,
  currentStage: 1,
  currentStatus: 1,
  originalConfigVersion: 1,
  currentConfigVersion: 1,
  configVersion: 1,
  submittedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  identifiers: 1,
};

// Only for a filter that names {clientRef, code} in every branch.
const findRowsByRefAndCode = async (filter, options = {}) => {
  const docs = await db
    .collection(collection)
    .find(filter, {
      maxTimeMS: config.adminReadTimeoutMs,
      projection: ROW_PROJECTION,
      hint: { clientRef: 1, code: 1 },
      ...options,
    })
    .toArray();

  return docs.map(toApplicationRow);
};

export const findApplicationRowsByClientRefs = ({ clientRefs, code }) =>
  findRowsByRefAndCode({ clientRef: { $in: clientRefs }, code });

const readOne = async (pipeline) => {
  const [doc] = await db
    .collection(collection)
    .aggregate(pipeline, { maxTimeMS: config.adminReadTimeoutMs })
    .toArray();

  return doc ?? null;
};

export const findApplicationSummaryRow = async ({ clientRef, code }) => {
  const doc = await readOne([
    { $match: { clientRef, code } },
    { $project: { ...SUMMARY_PROJECTION, storedBytes } },
  ]);

  return doc
    ? { summary: toApplicationSummary(doc), storedBytes: doc.storedBytes }
    : null;
};

// The Raw tab's stored document, exactly as stored. One over `maxBytes` is
// never sent: only its size is.
export const findStoredApplicationDocument = async (
  { clientRef, code },
  { maxBytes },
) => {
  const found = await readOne([
    { $match: { clientRef, code } },
    {
      $project: {
        _id: 0,
        storedBytes,
        document: cappedField("$$ROOT", maxBytes),
      },
    },
  ]);

  return found
    ? { storedBytes: found.storedBytes, document: found.document ?? null }
    : null;
};

export const findApplicationIdentifiers = async ({ clientRef, code }) => {
  const doc = await db
    .collection(collection)
    .findOne(
      { clientRef, code },
      { maxTimeMS: config.adminReadTimeoutMs, projection: { identifiers: 1 } },
    );

  return doc && toIdentifiers(doc.identifiers);
};
