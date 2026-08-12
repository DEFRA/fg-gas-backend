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

export const updateFetchStatus = async (
  grantCode,
  version,
  fetchStatus,
  fetchError = null,
) => {
  const now = new Date().toISOString();
  const update = {
    fetchStatus,
    fetchError,
    lastFetchAttemptAt: now,
    "definitions.grant.fetchStatus": fetchStatus,
    "definitions.grant.fetchError": fetchError,
    "definitions.grant.lastFetchAttemptAt": now,
  };

  if (fetchStatus === FetchStatus.Fetched) {
    update.fetchedAt = now;
    update["definitions.grant.fetchedAt"] = now;
  }

  const mongoUpdate = { $set: update };
  if (fetchStatus !== FetchStatus.Fetched) {
    mongoUpdate.$inc = {
      fetchAttempts: 1,
      "definitions.grant.fetchAttempts": 1,
    };
  }

  return db
    .collection(collection)
    .updateOne({ grantCode, version }, mongoUpdate);
};

export const findByGrantCodeAndVersion = async (grantCode, version) => {
  const doc = await db.collection(collection).findOne({ grantCode, version });

  return ConfigVersion.fromDocument(doc);
};
