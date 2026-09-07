export const up = async (db) => {
  const configVersions = db.collection("config_versions");

  // Release A wrote Grant fetch state to both locations, but tasks from the
  // preceding release could still update only the top-level fields during its
  // rollout. Reconcile once more before the nested state becomes canonical.
  await configVersions.updateMany({ fetchStatus: { $exists: true } }, [
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
};
