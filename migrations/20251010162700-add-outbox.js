export const up = async (db) => {
  await db.createCollection("outbox");
};

export const down = async (db) => {
  await db.collection("outbox").drop();
};
