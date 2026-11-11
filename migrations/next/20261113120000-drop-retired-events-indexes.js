import { logger } from "../../src/common/logger.js";

// For the release after 20261112120000-events-list-indexes: move this file up
// into migrations/ then. migrate-mongo reads only the files directly in
// migrations/, so here it does not run, and the release that stops reading
// these indexes can roll out while the one before still does.
//
// Nothing but the old buckets reads them: the publisher and pollers claim on
// their own status indexes, the TTL index is `expireAt`, and the Overview
// reads `{status}` and `{status, errorKey, eventType}`.
const LIST = { publicationDate: -1, _id: -1 };
const INDEX_NOT_FOUND = 27;

const retired = {
  outbox: [
    { eventType: 1, status: 1, errorKey: 1, ...LIST },
    { eventType: 1, refs: 1, ...LIST },
  ],
  inbox: [{ status: 1, eventType: 1, ...LIST }],
};

const drop = async (collection, key) => {
  try {
    await collection.dropIndex(key);
    logger.info(
      `Dropped index ${JSON.stringify(key)} on ${collection.collectionName}`,
    );
  } catch (error) {
    if (error.code !== INDEX_NOT_FOUND) {
      throw error;
    }
  }
};

export const up = async (db) => {
  for (const [box, keys] of Object.entries(retired)) {
    for (const key of keys) {
      await drop(db.collection(box), key);
    }
  }
};

export const down = async (db) => {
  for (const [box, keys] of Object.entries(retired)) {
    for (const key of keys) {
      await db.collection(box).createIndex(key);
    }
  }
};
