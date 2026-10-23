import { logger } from "../src/common/logger.js";

const COLLECTION = "grant_settings";
const INDEX_KEY = { grantCode: 1 };
const NAMESPACE_NOT_FOUND = 26;

const sameKey = ({ key }) => JSON.stringify(key) === JSON.stringify(INDEX_KEY);

const isUnsound = (index) =>
  !index.unique ||
  index.partialFilterExpression ||
  index.collation ||
  index.hidden ||
  index.sparse;

const existingIndexes = async (settings) => {
  try {
    return await settings.indexes();
  } catch (error) {
    if (error.code === NAMESPACE_NOT_FOUND) {
      return [];
    }

    throw error;
  }
};

export const up = async (db) => {
  const settings = db.collection(COLLECTION);
  const existing = (await existingIndexes(settings)).find(sameKey);

  if (existing && isUnsound(existing)) {
    throw new Error(
      `Index ${existing.name} on ${COLLECTION} must be unique and must not be partial, collated, hidden or sparse`,
    );
  }

  if (existing) {
    logger.info(`Index ${existing.name} on ${COLLECTION} already present`);
    return;
  }

  await settings.createIndex(INDEX_KEY, { unique: true });
};
