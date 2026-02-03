export const up = async (db) => {
  const fifoLock = db.collection("fifo_locks");
  fifoLock.drop().catch(() => {});
  fifoLock.createIndex({ segregationRef: 1 }, { unique: true });
  fifoLock.createIndex({ locked: 1, segregationRef: 1, lockedAt: 1 });
};
