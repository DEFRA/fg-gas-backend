export const up = async (db) => {
  const grants = db.collection("grants");

  await grants.updateMany(
    { version: { $exists: false } },
    { $set: { version: "0.0.0" } },
  );

  await grants.createIndex({ code: 1, version: 1 }, { unique: true });
  await grants.dropIndex("code_1").catch(() => {});
};
