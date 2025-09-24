export const up = async (db) => {
  const collections = (await db.collections()).map((c) => c.collectionName);

  if (collections.includes("grants")) {
    await db.dropCollection("grants");
  }

  if (collections.includes("applications")) {
    await db.dropCollection("applications");
  }

  await db.createCollection("grants");
  await db.createCollection("applications");

  await db.createIndex("grants", { code: 1 }, { unique: true });
  await db.createIndex(
    "applications",
    { clientRef: 1, code: 1 },
    { unique: true },
  );
};

export const down = async (db) => {
  await db.dropCollection("applications");
  await db.dropCollection("grants");
};
