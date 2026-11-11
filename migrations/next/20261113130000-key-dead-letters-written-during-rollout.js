import { toErrorKey } from "../../src/common/buckets/error-key.js";
import { logger } from "../../src/common/logger.js";
import { NO_ERROR_KEY } from "../../src/events/last-error.js";

// For the release after 20261111120000-key-dead-letters-without-error: move it
// up into migrations/ then (its imports lose one "../"). It keys the dead
// letters that instances still on the old code wrote, keyless, while that
// release rolled out. The same up() as that migration; running it changes
// nothing once every dead row has its key.
const BOXES = ["outbox", "inbox"];
const DIED = { $in: ["DEAD_LETTER", "PURGED"] };
const BATCH_SIZE = 1000;

const keyFromLastError = async (collection) => {
  const unkeyed = collection.find(
    { status: DIED, errorKey: null, lastError: { $ne: null } },
    { projection: { lastError: 1 } },
  );
  let keyed = 0;
  let batch = [];

  const flush = async () => {
    if (batch.length) {
      keyed += (await collection.bulkWrite(batch)).modifiedCount;
      batch = [];
    }
  };

  for await (const { _id, lastError } of unkeyed) {
    batch.push({
      updateOne: {
        filter: { _id, errorKey: null },
        update: { $set: { errorKey: toErrorKey(lastError) } },
      },
    });

    if (batch.length === BATCH_SIZE) {
      await flush();
    }
  }

  await flush();

  return keyed;
};

export const up = async (db) => {
  for (const box of BOXES) {
    const collection = db.collection(box);
    const fromLastError = await keyFromLastError(collection);
    const { modifiedCount: withoutError } = await collection.updateMany(
      { status: DIED, errorKey: null, lastError: null },
      { $set: { errorKey: NO_ERROR_KEY } },
    );

    logger.info(
      `Keyed ${box} dead letters: ${fromLastError} from their last error, ${withoutError} with none recorded`,
    );
  }
};
