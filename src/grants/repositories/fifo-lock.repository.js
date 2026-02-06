import { config } from "../../common/config.js";
import { db } from "../../common/mongo-client.js";
import { FifoLock } from "../models/fifo-lock.js";

const collection = "fifo_locks";

export const getFifoLocks = async (actor) => {
  const results = await db
    .collection(collection)
    .find({ locked: true, actor })
    .toArray();
  return results.map((doc) => FifoLock.fromDocument(doc));
};

export const setFifoLock = async (actor, segregationRef) => {
  await db.collection(collection).updateOne(
    { segregationRef, actor },
    {
      $set: {
        lockedAt: new Date(Date.now()),
        locked: true,
      },
    },
    { upsert: true },
  );
};

export const freeFifoLock = async (actor, segregationRef) => {
  await db.collection(collection).updateOne(
    { segregationRef, actor },
    {
      $set: {
        lockedAt: null,
        locked: false,
      },
    },
  );
};

export const cleanupStaleLocks = async () => {
  const staleThreshold = new Date(Date.now() - config.fifoLock.ttlMs);
  const result = await db.collection(collection).updateMany(
    {
      locked: true,
      lockedAt: { $lt: staleThreshold },
    },
    {
      $set: {
        lockedAt: null,
        locked: false,
      },
    },
  );
  return result;
};
