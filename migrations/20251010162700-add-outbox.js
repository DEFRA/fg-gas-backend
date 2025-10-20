export const up = async (db) => {
  await db.createCollection("outbox");
  await db.collection("outbox").createIndex({
    status: 1,
    claimedBy: 1,
    completionAttempts: 1,
    publicationDate: 1,
  });

  await db.collection("outbox").createIndex({
    claimExpiresAt: 1,
  });

  await db.collection("outbox").createIndex({
    status: 1,
    completionAttempts: 1,
  });
};

export const down = async (db) => {
  await db.collection("outbox").drop();
};
