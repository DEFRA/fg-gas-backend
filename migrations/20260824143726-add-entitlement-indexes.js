export const up = async (db) => {
  const entitlements = db.collection("entitlements");

  await entitlements.createIndex({ clientRef: 1, code: 1 });

  await entitlements.createIndex({ id: 1 }, { unique: true });
};
