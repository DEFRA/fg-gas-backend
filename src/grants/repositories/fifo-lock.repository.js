import { db } from "../../common/mongo-client.js";
import { FifoLock } from "../models/fifo-lock.js";

const collection = "fifo_locks";

export const getFifoLocks = async () => {
  const results = await db
    .collection(collection)
    .find({ locked: true })
    .toArray();
  return results.map((doc) => FifoLock.fromDocument(doc));
};

export const setFifoLock = async (segregationRef) => {
  await db.collection(collection).updateOne(
    { segregationRef },
    {
      $set: {
        lockedAt: new Date(Date.now()),
        locked: true,
      },
    },
    { upsert: true },
  );
};

export const freeFifoLock = async (segregationRef) => {
  await db.collection(collection).updateOne(
    { segregationRef },
    {
      $set: {
        lockedAt: null,
        locked: false,
      },
    },
  );
};
