import { toErrorKey } from "../src/common/buckets/error-key.js";
import { logger } from "../src/common/logger.js";
import { NO_ERROR_KEY } from "../src/events/last-error.js";

// Every dead letter, and every purged one (a purge keeps the key it died
// with), gets the key Top errors groups it by and the Error filter asks for:
// its last error's key, or NO_ERROR_KEY when it recorded none. Read on the
// status index, so only those rows are visited. Running it again changes
// nothing.
//
// Rolling deploys: instances still on the old code keep writing dead letters
// with no key until the rollout ends. migrations/next/ holds the same
// migration under a later timestamp, which keys those rows in the next release.
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
