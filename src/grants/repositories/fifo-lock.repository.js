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
