import { ensureIndexes } from "../src/common/buckets/indexes.js";
import { outboxBucket } from "../src/events/buckets/outbox.bucket.js";

const LIST = { publicationDate: -1, _id: -1 };
const INDEX_NOT_FOUND = 27;

// The outbox's error name and error key each get a line after status, so a
// list asking for either alone is exact. Add-only.
const added = [
  { status: 1, "lastError.name": 1, ...LIST },
  { status: 1, errorKey: 1, ...LIST },
];

export const up = async (db) => {
  await ensureIndexes(db, outboxBucket());
};

export const down = async (db) => {
  for (const key of added) {
    await db
      .collection("outbox")
      .dropIndex(key)
      .catch((error) => {
        if (error.code !== INDEX_NOT_FOUND) {
          throw error;
        }
      });
  }
};
