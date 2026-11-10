import { logger } from "../src/common/logger.js";

// FGP-1534: authentication reads `clientId`, so tokens that name their service
// only in `client` get it copied across, unless that would grant admin access.
// Self-contained so later changes to src/auth cannot change what it does on a
// database that has not run it yet.

const ADMIN_CLIENT = "fg-grants-platform-admin";
const SEEDED_CLIENT_ID_INDEX = "seeded_client_id_unique";
const DUPLICATE_KEY = 11000;

const isIdentity = (field) => ({
  $cond: [
    { $eq: [{ $type: `$${field}` }, "string"] },
    { $ne: [{ $trim: { input: `$${field}` } }, ""] },
    false,
  ],
});

const legacyOnly = {
  $and: [
    { $not: [isIdentity("clientId")] },
    isIdentity("client"),
    { $ne: ["$client", ADMIN_CLIENT] },
  ],
};

const seededWithClientId = { seeded: true, clientId: { $type: "string" } };

const backfillClientIds = async (accessTokens) => {
  const { modifiedCount } = await accessTokens.updateMany(
    { $expr: legacyOnly },
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
      { readPreference: "primary" },
    )
    .toArray();

  return result?.records ?? 0;
};

// Skipped rather than failed when seeded records share a clientId, so that
// legacy data cannot stop the migration.
const createSeededClientIdIndex = async (accessTokens) => {
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

export const up = async (db) => {
  const accessTokens = db.collection("access_tokens");

  const backfilled = await backfillClientIds(accessTokens);
  await accessTokens.createIndex({ clientId: 1 });
  const indexed = await createSeededClientIdIndex(accessTokens);

  logger.info(
    `Copied client to clientId on ${backfilled} access tokens, seeded clientId index ${indexed ? "created" : "deferred"}`,
  );
};
