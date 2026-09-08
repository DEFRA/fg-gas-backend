export const up = async (db) => {
  await db.collection("inbox").createIndex({ eventTime: -1, _id: -1 });
  await db.collection("outbox").createIndex({ publicationDate: -1, _id: -1 });
};
