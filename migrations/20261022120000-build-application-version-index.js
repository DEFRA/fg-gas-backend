import { ensureIndexes } from "../src/common/buckets/indexes.js";
import { logger } from "../src/common/logger.js";
import { applicationsBucket } from "../src/grants/buckets/applications.bucket.js";

// Builds the Applications list's grant and version line. The bucket's other
// keys exist already and are kept.
export const up = async (db) => {
  logger.info("Building the Applications list's grant and version index");
  await ensureIndexes(db, applicationsBucket());
};
