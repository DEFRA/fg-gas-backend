import {
  backfillClientIds,
  createSeededClientIdIndex,
} from "../src/auth/access-token-identity.js";
import { logger } from "../src/common/logger.js";

// FGP-1534: authentication reads `clientId`, so tokens that name their service
// only in `client` get it copied across, unless that would grant admin access.
// `client` and its indexes stay until every version reads `clientId`.
export const up = async (db) => {
  const accessTokens = db.collection("access_tokens");

  const backfilled = await backfillClientIds(accessTokens);
  await accessTokens.createIndex({ clientId: 1 });
  const indexed = await createSeededClientIdIndex(accessTokens);

  logger.info(
    `Copied client to clientId on ${backfilled} access tokens, seeded clientId index ${indexed ? "created" : "deferred"}`,
  );
};
