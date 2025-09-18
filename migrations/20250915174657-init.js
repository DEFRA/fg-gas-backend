export const up = async (db) => {
  await db.dropCollection("applications");
  await db.dropCollection("grants");

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
