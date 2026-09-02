export const up = async (db) => {
  await db.collection("inbox").createIndex({ eventTime: -1, _id: -1 });
  await db.collection("outbox").createIndex({ publicationDate: -1, _id: -1 });
};

export const down = async (db) => {
  await db.collection("inbox").dropIndex("eventTime_-1__id_-1");
  await db.collection("outbox").dropIndex("publicationDate_-1__id_-1");
};
