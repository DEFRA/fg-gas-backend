export const up = async (db) => {
  await db.collection("inbox").createIndex({ status: 1, claimExpiresAt: 1 });
  await db.collection("outbox").createIndex({ status: 1, claimExpiresAt: 1 });
};
