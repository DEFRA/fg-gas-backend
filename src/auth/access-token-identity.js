import { db } from "../common/mongo-client.js";
import { logger } from "../common/logger.js";
import { ADMIN_CLIENT } from "../grant-admin/admin-client.js";

// FGP-1534: access tokens name their service in `client`, `clientId` or both,
// while authentication reads only `clientId`. This copies `client` into
// `clientId` where that changes no access, and counts every other shape so the
// logs show when `client` can be removed. Remove with `client` itself.

export const SEEDED_CLIENT_ID_INDEX = "seeded_client_id_unique";

const DUPLICATE_KEY = 11000;

const primary = { readPreference: "primary" };

const isIdentity = (field) => ({
  $cond: [
    { $eq: [{ $type: `$${field}` }, "string"] },
    { $ne: [{ $trim: { input: `$${field}` } }, ""] },
    false,
  ],
});

const hasClientId = isIdentity("clientId");
const hasClient = isIdentity("client");
const lacksClientId = { $not: [hasClientId] };
const differs = { $ne: ["$client", "$clientId"] };

const shapes = {
  canonical: {
    $and: [hasClientId, { $not: [{ $and: [hasClient, differs] }] }],
  },
  conflicting: { $and: [hasClientId, hasClient, differs] },
  // Auth ignores `client`, so these tokens have never passed the grant-admin
  // guard. Copying the admin name into `clientId` would let them through.
  adminLegacyOnly: {
    $and: [lacksClientId, { $eq: ["$client", ADMIN_CLIENT] }],
  },
  legacyOnly: {
    $and: [lacksClientId, hasClient, { $ne: ["$client", ADMIN_CLIENT] }],
  },
  invalid: { $and: [lacksClientId, { $not: [hasClient] }] },
};

const seededWithClientId = { seeded: true, clientId: { $type: "string" } };

export const backfillClientIds = async (accessTokens) => {
  const { modifiedCount } = await accessTokens.updateMany(
    { $expr: shapes.legacyOnly },
    [{ $set: { clientId: "$client" } }],
  );

  return modifiedCount;
};

const countSeededCollisions = async (accessTokens) => {
  const [result] = await accessTokens
    .aggregate(
      [
        { $match: seededWithClientId },
        { $group: { _id: "$clientId", records: { $sum: 1 } } },
        { $match: { records: { $gt: 1 } } },
        { $group: { _id: null, records: { $sum: "$records" } } },
      ],
      primary,
    )
    .toArray();

  return result?.records ?? 0;
};

// Skipped rather than failed when seeded records share a clientId, so that
// legacy data cannot stop the service starting.
export const createSeededClientIdIndex = async (accessTokens) => {
  if ((await countSeededCollisions(accessTokens)) > 0) {
    return false;
  }

  try {
    await accessTokens.createIndex(
      { clientId: 1, seeded: 1 },
      {
        unique: true,
        partialFilterExpression: seededWithClientId,
        name: SEEDED_CLIENT_ID_INDEX,
      },
    );
    return true;
  } catch (error) {
    if (error.code === DUPLICATE_KEY) {
      return false;
    }
    throw error;
  }
};

const countShape = (accessTokens, shape) =>
  accessTokens.countDocuments({ $expr: shape }, primary);

export const countIdentityShapes = async (accessTokens) => {
  const [
    canonical,
    conflicting,
    conflictingSeeded,
    adminLegacyOnly,
    legacyOnly,
    invalid,
    seededCollisions,
  ] = await Promise.all([
    countShape(accessTokens, shapes.canonical),
    countShape(accessTokens, shapes.conflicting),
    accessTokens.countDocuments(
      { seeded: true, $expr: shapes.conflicting },
      primary,
    ),
    countShape(accessTokens, shapes.adminLegacyOnly),
    countShape(accessTokens, shapes.legacyOnly),
    countShape(accessTokens, shapes.invalid),
    countSeededCollisions(accessTokens),
  ]);

  return {
    canonical,
    conflicting,
    conflictingSeeded,
    adminLegacyOnly,
    legacyOnly,
    invalid,
    seededCollisions,
  };
};

const hasSeededClientIdIndex = async (accessTokens) =>
  (await accessTokens.indexes()).some(
    ({ name }) => name === SEEDED_CLIENT_ID_INDEX,
  );

const UNRESOLVED = [
  "conflictingSeeded",
  "adminLegacyOnly",
  "legacyOnly",
  "invalid",
  "seededCollisions",
];

const isComplete = (counts, indexed) =>
  indexed && UNRESOLVED.every((shape) => counts[shape] === 0);

// Runs on every boot so records written by older versions, or left behind by
// the migration, keep showing up until they are resolved. Never fails startup.
export const reportAccessTokenIdentity = async () => {
  try {
    const accessTokens = db.collection("access_tokens");
    const [counts, indexed] = await Promise.all([
      countIdentityShapes(accessTokens),
      hasSeededClientIdIndex(accessTokens),
    ]);

    const message =
      `Access token identity: ${counts.canonical} canonical, ` +
      `${counts.conflicting} conflicting (${counts.conflictingSeeded} seeded), ` +
      `${counts.legacyOnly} client only, ` +
      `${counts.adminLegacyOnly} admin client only, ` +
      `${counts.invalid} without an identity, ` +
      `${counts.seededCollisions} seeded sharing a clientId, ` +
      `seeded clientId index ${indexed ? "present" : "missing"}`;

    if (isComplete(counts, indexed)) {
      logger.info(message);
    } else {
      logger.warn(message);
    }
  } catch (error) {
    logger.error(
      { code: error.code },
      `Failed to report access token identity: ${error.message}`,
    );
  }
};
