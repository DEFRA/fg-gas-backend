import Boom from "@hapi/boom";
import { MongoServerError, ObjectId } from "mongodb";
import { config } from "../../common/config.js";
import { db } from "../../common/mongo-client.js";
import { paginate } from "../../common/paginate.js";
import { Agreement, AgreementHistoryEntry } from "../models/agreement.js";
import { ApplicationDocument } from "../models/application-document.js";
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

// Bounds are compared as stored: ISO strings, normalised to UTC.
const createdAtBounds = ({ from, to }) => ({
  ...(from && { $gte: new Date(from).toISOString() }),
  ...(to && { $lte: new Date(to).toISOString() }),
});

const listFilter = ({ code, from, to }) => ({
  ...(code && { code }),
  ...((from || to) && { createdAt: createdAtBounds({ from, to }) }),
});

export const findApplicationRowsPage = async ({
  code,
  from,
  to,
  cursor,
  pageSize,
}) => {
  const page = await paginate(db.collection(collection), {
    maxTimeMS: config.adminReadTimeoutMs,
    filter: listFilter({ code, from, to }),
    sort: listSort,
    codecs: listCodecs,
    cursor,
    pageSize,
    project: ROW_PROJECTION,
  });

  return { rows: page.data.map(toApplicationRow), pagination: page.pagination };
};

// Every member of each series, plus the ref itself where it has no series.
// Each branch names a {clientRef, code} pair, which is what makes the hint
// hold: a selective created-time range cannot steer the read onto a list index.
const seriesBranches = (ref, series) => [
  ...series.map((s) => ({
    code: s.code,
    clientRef: { $in: [...s.clientRefs] },
  })),
  { clientRef: ref },
];

export const findApplicationRowsInSeries = async ({
  ref,
  series,
  code,
  from,
  to,
  limit,
}) => {
  const docs = await db
    .collection(collection)
    .find(
      { $or: seriesBranches(ref, series), ...listFilter({ code, from, to }) },
      {
        maxTimeMS: config.adminReadTimeoutMs,
        projection: ROW_PROJECTION,
        sort: listSort,
        limit,
        hint: { clientRef: 1, code: 1 },
      },
    )
    .toArray();

  return docs.map(toApplicationRow);
};

export const countApplicationRows = ({ code, from, to }, { limit }) =>
  db.collection(collection).countDocuments(listFilter({ code, from, to }), {
    maxTimeMS: config.adminReadTimeoutMs,
    limit,
  });

const readOne = async (pipeline) => {
  const [doc] = await db
    .collection(collection)
    .aggregate(pipeline, { maxTimeMS: config.adminReadTimeoutMs })
    .toArray();

  return doc ?? null;
};

// $bsonSize measures the whole stored document before any projection.
const storedBytes = { $bsonSize: "$$ROOT" };

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
        document: {
          $cond: [{ $lte: [storedBytes, maxBytes] }, "$$ROOT", "$$REMOVE"],
        },
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
