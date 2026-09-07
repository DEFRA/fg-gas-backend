import { updateDefinitionFetchStatus } from "../../common/config-broker/config-catalog.repository.js";
import { FetchStatus } from "../../common/fetch-status.js";
import { db } from "../../common/mongo-client.js";
import { ConfigVersion } from "../models/config-version.js";

const collection = "config_versions";

const definitionLocationUpdate = (definitionType, s3Key) => ({
  [`definitions.${definitionType}`]: {
    $mergeObjects: [
      {
        fetchStatus: FetchStatus.Pending,
        fetchAttempts: 0,
        fetchError: null,
        fetchedAt: null,
        lastFetchAttemptAt: null,
      },
      { $ifNull: [`$definitions.${definitionType}`, {}] },
      { s3Key: { $literal: s3Key } },
    ],
  },
});

export const upsert = async (
  configVersion,
  { agreementS3Key, paymentS3Key } = {},
) => {
  const doc = configVersion.toDocument();

  const grant = doc.definitions.grant;
  const fetchState = {
    fetchedAt: grant.fetchedAt,
    fetchStatus: grant.fetchStatus,
    fetchError: grant.fetchError,
    fetchAttempts: grant.fetchAttempts,
    lastFetchAttemptAt: grant.lastFetchAttemptAt,
  };

  // $literal preserves leading "$" in broker values.
  return db.collection(collection).updateOne(
    { grantCode: doc.grantCode, version: doc.version },
    [
      {
        $set: {
          major: doc.major,
          minor: doc.minor,
          patch: doc.patch,
          status: doc.status,
          s3Bucket: { $literal: doc.s3Bucket },
          receivedAt: { $ifNull: ["$receivedAt", doc.receivedAt] },
          "definitions.grant": {
            $mergeObjects: [
              fetchState,
              { $ifNull: ["$definitions.grant", {}] },
              { s3Key: { $literal: grant.s3Key } },
            ],
          },
          ...(agreementS3Key &&
            definitionLocationUpdate("agreement", agreementS3Key)),
          ...(paymentS3Key &&
            definitionLocationUpdate("payment", paymentS3Key)),
        },
      },
    ],
    { upsert: true },
  );
};

// Resolves the highest active version within the same major (any minor/patch).
// Lazy filter: only excludes PermanentError so an uncached newer version is
// still selectable and triggers an on-demand S3 fetch. Do not require s3Key:
// seeded 0.0.0 rows have a null key and resolve their already-cached Grant.
export const findLatestForMajor = async (grantCode, major) => {
  const doc = await db.collection(collection).findOne(
    {
      grantCode,
      major,
      status: "active",
      $or: [
        {
          "definitions.grant.fetchStatus": {
            $exists: true,
            $ne: FetchStatus.PermanentError,
          },
        },
        {
          "definitions.grant.fetchStatus": { $exists: false },
          fetchStatus: { $ne: FetchStatus.PermanentError },
        },
      ],
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
) =>
  updateDefinitionFetchStatus({
    grantCode,
    version,
    definitionType: "grant",
    fetchStatus,
    fetchError,
  });

export const findByGrantCodeAndVersion = async (grantCode, version) => {
  const doc = await db.collection(collection).findOne({ grantCode, version });

  return ConfigVersion.fromDocument(doc);
};
