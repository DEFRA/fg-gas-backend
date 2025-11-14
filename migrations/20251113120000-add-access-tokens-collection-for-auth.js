export const up = async (db) => {
  const collections = (await db.collections()).map((c) => c.collectionName);

  if (collections.includes("access_tokens")) {
    await db.dropCollection("access_tokens");
  }

  await db.createCollection("access_tokens");

  await db.createIndex("access_tokens", { id: 1 }, { unique: true });
  await db.createIndex("access_tokens", { client: 1 });
  await db.createIndex("access_tokens", { expiresAt: 1 });
};

export const down = async (db) => {
  await db.dropCollection("access_tokens");
};
