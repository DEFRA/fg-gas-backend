/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  // purge the tables

  await db.dropCollection("grants");
  await db.dropCollection("applications");

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
