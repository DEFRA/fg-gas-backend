import { logger } from "../logger.js";
import { indexKeysOf } from "./bucket.js";

const NAMESPACE_NOT_FOUND = 26;
const NOT_PLAIN = ["partialFilterExpression", "sparse", "hidden", "collation"];

const isSameKey = (key) => (index) =>
  JSON.stringify(index.key) === JSON.stringify(key);

const isPlain = (index) => !NOT_PLAIN.some((option) => index[option]);

const noCollection = (error) => {
  if (error.code !== NAMESPACE_NOT_FOUND) {
    throw error;
  }

  return [];
};

const keepIndex = (collection, index) => {
  if (!isPlain(index)) {
    throw new Error(
      `Index ${index.name} on ${collection.collectionName} is not a plain index`,
    );
  }

  logger.info(
    `Bucket index ${index.name} on ${collection.collectionName} exists`,
  );
};

const buildIndex = async (collection, key) => {
  const startedAt = Date.now();
  const name = await collection.createIndex(key);

  logger.info(
    `Bucket index ${name} on ${collection.collectionName} built in ${Date.now() - startedAt}ms`,
  );
};

export const ensureIndexes = async (database, bucket) => {
  const collection = database.collection(bucket.collection);
  const existing = await collection
    .indexes({ readPreference: "primary" })
    .catch(noCollection);

  // One at a time, so a deployment builds no two indexes at once.
  await indexKeysOf(bucket).reduce(async (previous, key) => {
    await previous;
    const index = existing.find(isSameKey(key));

    return index ? keepIndex(collection, index) : buildIndex(collection, key);
  }, Promise.resolve());
};
