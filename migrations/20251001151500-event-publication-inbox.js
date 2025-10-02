export const up = async (db) => {
  await db.createCollection("event_publication_inbox");
};

export const down = async (db) => {
  await db.collection("event_publication_inbox").drop();
};
