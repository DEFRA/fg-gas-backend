import { logger } from "../src/common/logger.js";

// FGP-1572: a token's creation is when its _id was made. A token the old
// seeder rotated kept its _id, so it shows when it was first seeded.
export const up = async (db) => {
  const accessTokens = db.collection("access_tokens");
  const undated = { createdAt: { $exists: false } };

  const { modifiedCount } = await accessTokens.updateMany(undated, [
    { $set: { createdAt: { $toDate: "$_id" } } },
  ]);

  logger.info(`Dated ${modifiedCount} access tokens from their ids`);
};
