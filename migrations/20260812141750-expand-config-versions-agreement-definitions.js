export const up = async (db) => {
  const configVersions = db.collection("config_versions");

  await configVersions.updateMany({ "definitions.grant": { $exists: false } }, [
    {
      $set: {
        "definitions.grant": {
          s3Key: "$s3Key",
          fetchStatus: "$fetchStatus",
          fetchAttempts: "$fetchAttempts",
          fetchError: "$fetchError",
          fetchedAt: "$fetchedAt",
          lastFetchAttemptAt: "$lastFetchAttemptAt",
        },
      },
    },
  ]);

  await db
    .collection("agreements__definitions")
    .createIndex({ code: 1, version: 1 }, { unique: true });
};
