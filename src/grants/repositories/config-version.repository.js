import { FetchStatus } from "../../common/fetch-status.js";
import { db } from "../../common/mongo-client.js";
import { ConfigVersion } from "../models/config-version.js";

const collection = "config_versions";

export const upsert = async (configVersion) => {
  const doc = configVersion.toDocument();

  return db.collection(collection).updateOne(
    { grantCode: doc.grantCode, version: doc.version },
    {
      $set: {
        major: doc.major,
        minor: doc.minor,
        patch: doc.patch,
        status: doc.status,
        s3Key: doc.s3Key,
        s3Bucket: doc.s3Bucket,
      },
      $setOnInsert: {
        receivedAt: doc.receivedAt,
        fetchedAt: doc.fetchedAt,
        fetchStatus: doc.fetchStatus,
        fetchError: doc.fetchError,
        fetchAttempts: doc.fetchAttempts,
        lastFetchAttemptAt: doc.lastFetchAttemptAt,
      },
    },
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
  const update = {
    fetchStatus,
    fetchError,
    lastFetchAttemptAt: new Date().toISOString(),
  };

  if (fetchStatus === FetchStatus.Fetched) {
    update.fetchedAt = new Date().toISOString();
  }

  const mongoUpdate = { $set: update };
  if (fetchStatus !== FetchStatus.Fetched) {
    mongoUpdate.$inc = { fetchAttempts: 1 };
  }

  return db
    .collection(collection)
    .updateOne({ grantCode, version }, mongoUpdate);
};

export const findByGrantCodeAndVersion = async (grantCode, version) => {
  const doc = await db.collection(collection).findOne({ grantCode, version });

  return ConfigVersion.fromDocument(doc);
};
