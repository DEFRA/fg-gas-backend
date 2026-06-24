export const up = async (db) => {
  const collection = db.collection("config_versions");

  await collection.createIndex(
    { grantCode: 1, version: 1 },
    { unique: true },
  );

  await collection.createIndex({
    grantCode: 1,
    major: 1,
    minor: 1,
    patch: -1,
    status: 1,
  });
};
