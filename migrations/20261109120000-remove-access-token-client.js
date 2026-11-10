import { logger } from "../src/common/logger.js";

// FGP-1534: every version reads a token's service from `clientId`, and the
// naming migration gave every token one, so the legacy `client` field and its
// index go. A row without a usable `clientId` keeps `client`, so nothing that
// still names a service only there loses it.

const CLIENT_INDEX = "client_1";

const NAMESPACE_NOT_FOUND = 26;
const INDEX_NOT_FOUND = 27;

const hasClientId = {
  $expr: {
    $cond: [
      { $eq: [{ $type: "$clientId" }, "string"] },
      { $ne: [{ $trim: { input: "$clientId" } }, ""] },
      false,
    ],
  },
};

export const up = async (db) => {
  const accessTokens = db.collection("access_tokens");

  try {
    await accessTokens.dropIndex(CLIENT_INDEX);
  } catch (error) {
    if (![INDEX_NOT_FOUND, NAMESPACE_NOT_FOUND].includes(error.code)) {
      throw error;
    }
  }

  const { modifiedCount } = await accessTokens.updateMany(
    { client: { $exists: true }, ...hasClientId },
    { $unset: { client: "" } },
  );

  logger.info(`Removed client from ${modifiedCount} access tokens`);
};
