import { FetchStatus } from "../fetch-status.js";
import { db } from "../mongo-client.js";
import { buildFetchStateUpdate } from "./fetch-state-update.js";

const collection = "config_versions";

const definitionPath = (definitionType) => `definitions.${definitionType}`;

const toDefinition = (doc, definitionType) => {
  const definition = doc?.definitions?.[definitionType];

  if (!definition) {
    return null;
  }

  return {
    grantCode: doc.grantCode,
    version: doc.version,
    status: doc.status,
    major: doc.major,
    minor: doc.minor,
    patch: doc.patch,
    s3Bucket: doc.s3Bucket,
    ...definition,
  };
};

export const findConfigDefinition = async ({
  grantCode,
  version,
  definitionType,
}) => {
  const doc = await db
    .collection(collection)
    .findOne({ grantCode, version }, { readPreference: "primary" });
  return toDefinition(doc, definitionType);
};

// Omit minor/patch for the latest usable definition in the major; pass them to
// cap the result at that version.
export const findLatestUsableDefinition = async ({
  grantCode,
  major,
  minor,
  patch,
  definitionType,
}) => {
  const path = definitionPath(definitionType);
  const upperBound =
    minor === undefined
      ? {}
      : { $or: [{ minor: { $lt: minor } }, { minor, patch: { $lte: patch } }] };

  const doc = await db.collection(collection).findOne(
    {
      grantCode,
      major,
      status: "active",
      // $ne rather than $exists: s3Key is nullable, and legacy rows carry an
      // explicit null that $exists would accept as a usable location. $ne: null
      // excludes both the null and the missing field.
      [`${path}.s3Key`]: { $ne: null },
      [`${path}.fetchStatus`]: { $ne: FetchStatus.PermanentError },
      ...upperBound,
    },
    { sort: { minor: -1, patch: -1 }, readPreference: "primary" },
  );

  return toDefinition(doc, definitionType);
};

export const updateDefinitionLocation = async ({
  grantCode,
  version,
  definitionType,
  s3Key,
}) => {
  const path = definitionPath(definitionType);
  const defaults = {
    fetchStatus: FetchStatus.Pending,
    fetchAttempts: 0,
    fetchError: null,
    fetchedAt: null,
    lastFetchAttemptAt: null,
  };

  // Deliberately not an upsert: the config version record is written first and
  // carries the fields every read filters on (major, status). Creating a
  // document here would produce one without them, invisible to every query.
  return db.collection(collection).updateOne({ grantCode, version }, [
    {
      $set: {
        [path]: {
          $mergeObjects: [defaults, { $ifNull: [`$${path}`, {}] }, { s3Key }],
        },
      },
    },
  ]);
};

export const updateDefinitionFetchStatus = async ({
  grantCode,
  version,
  definitionType,
  fetchStatus,
  fetchError = null,
}) => {
  const { set, inc } = buildFetchStateUpdate({
    path: definitionPath(definitionType),
    fetchStatus,
    fetchError,
    at: new Date().toISOString(),
  });

  const mongoUpdate = { $set: set };
  if (inc) {
    mongoUpdate.$inc = inc;
  }

  return db
    .collection(collection)
    .updateOne({ grantCode, version }, mongoUpdate);
};
