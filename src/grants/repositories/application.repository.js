import Boom from "@hapi/boom";
import { MongoServerError, ObjectId } from "mongodb";
import { config } from "../../common/config.js";
import { db } from "../../common/mongo-client.js";
import { paginate } from "../../common/paginate.js";
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

const adminReadOptions = () => ({ maxTimeMS: config.adminReadTimeoutMs });

const listSort = { createdAt: -1, _id: -1 };

// A cursor comes back from the caller, so only an instant may reach the query.
const isIsoInstant = (value) => {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};

const decodeCreatedAt = (value) => {
  if (!isIsoInstant(value)) {
    throw new Error("Invalid createdAt in cursor");
  }

  return value;
};

// createdAt is an ISO string on every application, so it round-trips unchanged.
const listCodecs = {
  createdAt: {
    encode: (value) => value ?? null,
    decode: decodeCreatedAt,
  },
  _id: {
    encode: (id) => id.toString(),
    decode: (hex) => ObjectId.createFromHexString(hex),
  },
};

// Grant Admin reads the stored document, never an Application: the model
// drops fields an operator debugging a record needs to see.
export const findStoredPage = ({ filter, projection, cursor, pageSize }) =>
  paginate(db.collection(collection), {
    ...adminReadOptions(),
    filter,
    sort: listSort,
    codecs: listCodecs,
    cursor,
    pageSize,
    project: projection,
  });

// Every branch of a ref search names a {clientRef, code} pair. Hinted, so a
// selective created-time range cannot steer the plan onto a list index and
// scan it, unsorted reads having nothing else to pick between.
export const findStored = (filter, { projection, limit }) =>
  db
    .collection(collection)
    .find(filter, {
      ...adminReadOptions(),
      projection,
      limit,
      hint: { clientRef: 1, code: 1 },
    })
    .toArray();

export const countStored = (filter, limit) =>
  db
    .collection(collection)
    .countDocuments(filter, { ...adminReadOptions(), limit });

const readOne = async (pipeline) => {
  const [doc] = await db
    .collection(collection)
    .aggregate(pipeline, adminReadOptions())
    .toArray();

  return doc ?? null;
};

// $bsonSize measures the whole stored document before any projection.
const matchWithSize = ({ clientRef, code }) => [
  { $match: { clientRef, code } },
  { $set: { storedBytes: { $bsonSize: "$$ROOT" } } },
];

export const findStoredSummary = ({ clientRef, code }, projection) =>
  readOne([
    ...matchWithSize({ clientRef, code }),
    { $project: { ...projection, storedBytes: 1 } },
  ]);

// A document over `maxBytes` is never sent: only its size is.
export const findStoredDocument = ({ clientRef, code }, maxBytes) =>
  readOne([
    ...matchWithSize({ clientRef, code }),
    {
      $project: {
        _id: 0,
        storedBytes: 1,
        document: {
          $cond: [{ $lte: ["$storedBytes", maxBytes] }, "$$ROOT", "$$REMOVE"],
        },
      },
    },
  ]);

export const findStoredIdentifiers = ({ clientRef, code }) =>
  db
    .collection(collection)
    .findOne(
      { clientRef, code },
      { ...adminReadOptions(), projection: { identifiers: 1 } },
    );
