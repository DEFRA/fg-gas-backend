const LEGACY_TOP_LEVEL_GRANT_FETCH_FIELDS = [
  "s3Key",
  "fetchStatus",
  "fetchAttempts",
  "fetchError",
  "fetchedAt",
  "lastFetchAttemptAt",
];

const incompleteGrantStateFilter = {
  $or: LEGACY_TOP_LEVEL_GRANT_FETCH_FIELDS.map((field) => ({
    [`definitions.grant.${field}`]: { $exists: false },
  })),
};

export const up = async (db) => {
  const configVersions = db.collection("config_versions");

  const incompleteCount = await configVersions.countDocuments(
    incompleteGrantStateFilter,
  );

  if (incompleteCount > 0) {
    const examples = await configVersions
      .find(incompleteGrantStateFilter, {
        projection: { _id: 1, grantCode: 1, version: 1 },
      })
      .limit(10)
      .toArray();

    throw new Error(
      `Aborting: ${incompleteCount} config_versions record(s) have an incomplete ` +
        `definitions.grant and cannot safely lose the legacy top-level fields. ` +
        `Backfill/reconcile these first (see ` +
        `20260907100000-reconcile-config-versions-grant-definitions.js). ` +
        `Examples: ${JSON.stringify(examples)}`,
    );
  }

  await configVersions.updateMany(
    {},
    {
      $unset: Object.fromEntries(
        LEGACY_TOP_LEVEL_GRANT_FETCH_FIELDS.map((field) => [field, ""]),
      ),
    },
  );
};
