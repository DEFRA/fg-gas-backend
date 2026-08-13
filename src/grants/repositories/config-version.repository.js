import { buildFetchStateUpdate } from "../../common/config-broker/fetch-state-update.js";
import { FetchStatus } from "../../common/fetch-status.js";
import { db } from "../../common/mongo-client.js";
import { ConfigVersion } from "../models/config-version.js";

const collection = "config_versions";

export const upsert = async (configVersion) => {
  const doc = configVersion.toDocument();

  const fetchState = {
    fetchedAt: doc.fetchedAt,
    fetchStatus: doc.fetchStatus,
    fetchError: doc.fetchError,
    fetchAttempts: doc.fetchAttempts,
    lastFetchAttemptAt: doc.lastFetchAttemptAt,
  };

  return db.collection(collection).updateOne(
    { grantCode: doc.grantCode, version: doc.version },
    [
      {
        $set: {
          major: doc.major,
          minor: doc.minor,
          patch: doc.patch,
          status: doc.status,
          s3Key: doc.s3Key,
          s3Bucket: doc.s3Bucket,
          receivedAt: { $ifNull: ["$receivedAt", doc.receivedAt] },
          fetchedAt: { $ifNull: ["$fetchedAt", doc.fetchedAt] },
          fetchStatus: { $ifNull: ["$fetchStatus", doc.fetchStatus] },
          fetchError: { $ifNull: ["$fetchError", doc.fetchError] },
          fetchAttempts: { $ifNull: ["$fetchAttempts", doc.fetchAttempts] },
          lastFetchAttemptAt: {
            $ifNull: ["$lastFetchAttemptAt", doc.lastFetchAttemptAt],
          },
          "definitions.grant": {
            $mergeObjects: [
              fetchState,
              { $ifNull: ["$definitions.grant", {}] },
              { s3Key: doc.s3Key },
            ],
          },
        },
      },
    ],
    { upsert: true },
  );
};

// Resolves the highest active version within the same major (any minor/patch).
// Lazy filter: only excludes PermanentError so an uncached newer version is
// still selectable and triggers an on-demand S3 fetch.
export const findLatestForMajor = async (grantCode, major) => {
  const doc = await db.collection(collection).findOne(
    {
      grantCode,
      major,
      status: "active",
      fetchStatus: { $ne: FetchStatus.PermanentError },
    },
    { sort: { minor: -1, patch: -1 } },
  );

  return ConfigVersion.fromDocument(doc);
};

// Writes the Grant fetch state twice, top-level and under definitions.grant,
// because writes have moved to the nested shape while findLatestForMajor above
// still reads the top-level one. The nested half comes from the same builder the
// Agreement path uses, so the two cannot drift; the top-level half is the
// temporary compatibility write and goes away with those reads in FGP-1352. Both
// go in one updateOne so they are never briefly out of step with each other.
export const updateFetchStatus = async (
  grantCode,
  version,
  fetchStatus,
  fetchError = null,
) => {
  const now = new Date().toISOString();
  const nested = buildFetchStateUpdate({
    path: "definitions.grant",
    fetchStatus,
    fetchError,
    at: now,
  });

  const update = {
    $set: { fetchStatus, fetchError, lastFetchAttemptAt: now, ...nested.set },
  };

  if (fetchStatus === FetchStatus.Fetched) {
    update.$set.fetchedAt = now;
    // No top-level fetchAttempts reset to match the nested one: this counter
    // still drives the retry limit in resolve-config-version.service.js, and
    // clearing it would change that behaviour. It retires with the field.
  } else {
    update.$inc = { fetchAttempts: 1, ...nested.inc };
  }

  return db.collection(collection).updateOne({ grantCode, version }, update);
};

export const findByGrantCodeAndVersion = async (grantCode, version) => {
  const doc = await db.collection(collection).findOne({ grantCode, version });

  return ConfigVersion.fromDocument(doc);
};
