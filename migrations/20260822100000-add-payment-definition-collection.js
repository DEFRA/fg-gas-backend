export const up = async (db) => {
  await db
    .collection("payments__definitions")
    .createIndex({ code: 1, version: 1 }, { unique: true });
};
