import {
  updateDefinitionFetchStatus,
  withWorstFetchStatus,
} from "../../common/config-broker/config-catalog.repository.js";
import { config } from "../../common/config.js";
import { FetchStatus } from "../../common/fetch-status.js";
import { db } from "../../common/mongo-client.js";
import {
  ConfigVersion,
  ConfigVersionStatus,
} from "../models/config-version.js";

const collection = "config_versions";

// Resolves the highest active published version across all majors when the
// caller has no pinned version. Keep failed definitions selectable so loading
// refuses the current definition rather than silently falling back to an older one.
export const findLatestActive = async (grantCode) =>
  ConfigVersion.fromDocument(
    await db.collection(collection).findOne(
      { grantCode, status: ConfigVersionStatus.Active },
      {
        sort: { major: -1, minor: -1, patch: -1 },
      },
    ),
  );

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
      withWorstFetchStatus,
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
      status: ConfigVersionStatus.Active,
      "definitions.grant.fetchStatus": { $ne: FetchStatus.PermanentError },
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

// Every version of the grant, or only those named; newest version first.
export const findVersionsByGrantCode = (grantCode, versions) =>
  db
    .collection(collection)
    .find(
      { grantCode, ...(versions && { version: { $in: versions } }) },
      {
        sort: { major: -1, minor: -1, patch: -1 },
        projection: {
          _id: 0,
          grantCode: 1,
          version: 1,
          status: 1,
          receivedAt: 1,
          s3Bucket: 1,
          worstFetchStatus: 1,
          definitions: 1,
        },
        maxTimeMS: config.adminReadTimeoutMs,
      },
    )
    .toArray();

export const findVersionDocument = (grantCode, version) =>
  db
    .collection(collection)
    .findOne({ grantCode, version }, { maxTimeMS: config.adminReadTimeoutMs });
