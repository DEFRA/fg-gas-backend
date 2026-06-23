export const up = async (db) => {
  await db
    .collection("applications")
    .updateMany(
      { originalConfigVersion: { $exists: false } },
      { $set: { originalConfigVersion: null, currentConfigVersion: null } },
    );
};
