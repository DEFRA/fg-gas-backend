export const up = async (db) => {
  const grants = db.collection("grants");
  await grants.createIndex({ code: 1, version: 1 }, { unique: true });
  await grants.dropIndex("code_1");
};
