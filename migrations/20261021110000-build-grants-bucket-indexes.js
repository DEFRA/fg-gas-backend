import { ensureIndexes } from "../src/common/buckets/indexes.js";
import { grantsBucket } from "../src/grants/buckets/grants.bucket.js";

// Built after the receivedAt normalisation, so that does not maintain them.
export const up = async (db) => {
  await ensureIndexes(db, grantsBucket());
};
