import { logger } from "../src/common/logger.js";

// FGP-1572: tokens are issued through Grant Admin, so nothing seeds them on
// boot and `seeded` marks nothing. The rows keep authenticating.
const SEEDED_INDEXES = ["seeded_client_unique", "seeded_client_id_unique"];

const NAMESPACE_NOT_FOUND = 26;
const INDEX_NOT_FOUND = 27;

const dropIfPresent = async (accessTokens, name) => {
  try {
    await accessTokens.dropIndex(name);
  } catch (error) {
    if (![INDEX_NOT_FOUND, NAMESPACE_NOT_FOUND].includes(error.code)) {
      throw error;
    }
  }
};

export const up = async (db) => {
  const accessTokens = db.collection("access_tokens");

  for (const name of SEEDED_INDEXES) {
    await dropIfPresent(accessTokens, name);
  }

  const { modifiedCount } = await accessTokens.updateMany(
    { seeded: { $exists: true } },
    { $unset: { seeded: "" } },
  );

  logger.info(`Removed seeded from ${modifiedCount} access tokens`);
};
