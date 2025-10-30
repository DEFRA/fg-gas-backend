export const up = async (db) => {
  await db.createCollection("inbox");
};

export const down = async (db) => {
  await db.collection("inbox").drop();
};
