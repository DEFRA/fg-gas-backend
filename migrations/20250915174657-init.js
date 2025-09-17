/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  // purge the tables
  const collectionNames = (await db.collections()).map((e) => e.collectionName);
  if (collectionNames.includes("cases")) {
    await db.dropCollection("cases");
  }
  if (collectionNames.includes("workflows")) {
    await db.dropCollection("workflows");
  }

  await db.createCollection("grants");
  await db.createCollection("applications");

  await Promise.all([
    db.createIndex("grants", { code: 1 }, { unique: true }),
    db.createIndex("applications", { clientRef: 1, code: 2 }, { unique: true }),
  ]);
};

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  await db.collection("grants").deleteOne({ code: "pigs-might-fly" });
};
