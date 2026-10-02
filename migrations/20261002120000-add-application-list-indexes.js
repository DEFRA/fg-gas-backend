import { logger } from "../src/common/logger.js";

// Mixed types in a sort key are type-bracketed in Mongo, so paging silently misses rows.
// Applications write createdAt as an ISO string; anything else becomes the ISO
// string of its own instant, or of the insert time where it has none.

const LIST_INDEXES = [
  { createdAt: -1, _id: -1 },
  { code: 1, createdAt: -1, _id: -1 },
];

const insertedAt = {
  $convert: { input: "$_id", to: "date", onError: "$$NOW", onNull: "$$NOW" },
};

const normaliseCreatedAt = (applications) =>
  applications.updateMany({ createdAt: { $not: { $type: "string" } } }, [
    {
      $set: {
        createdAt: {
          $toString: {
            $convert: {
              input: "$createdAt",
              to: "date",
              onError: insertedAt,
              onNull: insertedAt,
            },
          },
        },
      },
    },
  ]);

// On a large collection the platform team builds these out of band, under any
// name, so an existing index is matched by its key, in order.
const ensureIndex = async (applications, existing, key) => {
  const found = existing.find(
    (index) => JSON.stringify(index.key) === JSON.stringify(key),
  );

  if (found?.partialFilterExpression || found?.collation) {
    throw new Error(
      `Index ${found.name} on applications has the list key but is partial or collated`,
    );
  }

  if (found) {
    logger.info(`Index ${found.name} on applications already present`);
    return;
  }

  const started = Date.now();
  const name = await applications.createIndex(key);

  logger.info(
    `Built index ${name} on applications in ${Date.now() - started} ms`,
  );
};

export const up = async (db) => {
  const applications = db.collection("applications");

  const result = await normaliseCreatedAt(applications);

  logger.info(
    `Normalised ${result.modifiedCount} application createdAt values to ISO strings`,
  );

  const existing = await applications.indexes();

  for (const key of LIST_INDEXES) {
    await ensureIndex(applications, existing, key);
  }
};
