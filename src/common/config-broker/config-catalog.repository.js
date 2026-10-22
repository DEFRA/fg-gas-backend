import { FetchStatus, fetchStatusRank } from "../fetch-status.js";
import { db } from "../mongo-client.js";
import { buildFetchStateUpdate } from "./fetch-state-update.js";

const collection = "config_versions";

const definitionPath = (definitionType) => `definitions.${definitionType}`;

const fileRanks = {
  $map: {
    input: { $objectToArray: { $ifNull: ["$definitions", {}] } },
    as: "file",
    in: { $indexOfArray: [fetchStatusRank, "$$file.v.fetchStatus"] },
  },
};

// Null for no files or a file with no known status, so bad data never reads as Failed.
export const withWorstFetchStatus = {
  $set: {
    worstFetchStatus: {
      $let: {
        vars: { ranks: fileRanks },
        in: {
          $cond: [
            { $or: [{ $eq: ["$$ranks", []] }, { $in: [-1, "$$ranks"] }] },
            null,
            { $arrayElemAt: [fetchStatusRank, { $max: "$$ranks" }] },
          ],
        },
      },
    },
  },
};

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
      // $ne excludes missing and null locations.
      [`${path}.s3Key`]: { $ne: null },
      [`${path}.fetchStatus`]: { $ne: FetchStatus.PermanentError },
      ...upperBound,
    },
    { sort: { minor: -1, patch: -1 }, readPreference: "primary" },
  );

  return toDefinition(doc, definitionType);
};

export const updateDefinitionFetchStatus = async ({
  grantCode,
  version,
  definitionType,
  fetchStatus,
  fetchError = null,
}) => {
  const set = buildFetchStateUpdate({
    path: definitionPath(definitionType),
    fetchStatus,
    fetchError,
    at: new Date().toISOString(),
  });

  return db
    .collection(collection)
    .updateOne({ grantCode, version }, [{ $set: set }, withWorstFetchStatus]);
};
