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

const CHECK_MAX_TIME_MS = 10_000;

const nameOf = (key) =>
  Object.entries(key)
    .map(([field, direction]) => `${field}_${direction}`)
    .join("_");

const isClosed = (fact) => Array.isArray(fact.values);

const closedFacts = (bucket) =>
  Object.entries(bucket.facts)
    .filter(([, fact]) => isClosed(fact))
    .map(([name, fact]) => ({ name, fact }));

// A closed fact is checked only when it leads a usable index, so `distinct`
// can read that index and never scans the collection.
const leadsUsableIndex = (bucket, name, isUsable) =>
  indexKeysOf(bucket).some(
    (key) => Object.keys(key)[0] === name && isUsable(key),
  );

// Compared by type as well as value, as the engine's `$in` matches.
const undeclaredValues = async (collection, { name, fact }) => {
  const declared = new Set(fact.values.map(({ value }) => value));
  const stored = await collection.distinct(
    name,
    {},
    { maxTimeMS: CHECK_MAX_TIME_MS },
  );

  return stored.filter((value) => value !== null && !declared.has(value));
};

const checkValues = async (bucket, collection, closed) => {
  const values = await undeclaredValues(collection, closed);

  if (values.length > 0) {
    logger.error(
      `Bucket ${bucket.id} holds ${closed.name} values it doesn't declare: ${values.map((value) => JSON.stringify(value)).join(", ")}`,
    );
  }
};

// One after another, never side by side, to keep start-up load low.
const inTurn = (items, check) =>
  items.reduce(
    (checked, item) => checked.then(() => check(item)),
    Promise.resolve(),
  );

const checkClosed = (bucket, collection, isUsable) => async (closed) => {
  if (leadsUsableIndex(bucket, closed.name, isUsable)) {
    await checkValues(bucket, collection, closed);
  } else {
    logger.warn(
      `Bucket ${bucket.id} ${closed.name} values are not checked: it leads no usable index`,
    );
  }
};

const checkBucket = async (database, bucket) => {
  const collection = database.collection(bucket.collection);
  const existing = await collection
    .indexes({ maxTimeMS: CHECK_MAX_TIME_MS })
    .catch(noCollection);
  const isUsable = (key) =>
    existing.some((index) => isSameKey(key)(index) && isPlain(index));

  indexKeysOf(bucket).forEach((key) => {
    const index = existing.find(isSameKey(key));

    if (!index) {
      logger.error(`Bucket ${bucket.id} is missing index ${nameOf(key)}`);
      return;
    }

    if (!isPlain(index)) {
      logger.error(
        `Bucket ${bucket.id} index ${nameOf(key)} is not a plain index`,
      );
    }
  });

  await inTurn(closedFacts(bucket), checkClosed(bucket, collection, isUsable));
};

// Each bucket's declared indexes are built, and its closed facts hold only
// their declared values. Buckets are checked one at a time, to keep start-up
// load low, and a gap is logged, never thrown, so the check can run behind
// start-up.
export const checkDeclaredIndexes = async (database, buckets) => {
  let failed = 0;

  await inTurn(buckets, async (bucket) => {
    try {
      await checkBucket(database, bucket);
    } catch (error) {
      failed += 1;
      logger.error(
        error,
        `Declared index check failed for bucket ${bucket.id}`,
      );
    }
  });

  logger.info(
    `Checked declared indexes and stored values of ${buckets.length - failed} of ${buckets.length} buckets`,
  );
};
