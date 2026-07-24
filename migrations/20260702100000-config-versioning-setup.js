export const up = async (db) => {
  // --- 1. Create config_versions collection indexes ---
  const configVersions = db.collection("config_versions");
  await configVersions.createIndex(
    { grantCode: 1, version: 1 },
    { unique: true },
  );
  await configVersions.createIndex({
    grantCode: 1,
    major: 1,
    minor: 1,
    patch: -1,
    status: 1,
  });

  // --- 2. Grants compound index (code + version) ---
  // Handled by 20260629100000-add-grant-version.js which sets version
  // "0.0.0" on all grants and creates the { code: 1, version: 1 } index.

  // --- 3. Add config version fields to existing applications ---
  await db
    .collection("applications")
    .updateMany(
      { originalConfigVersion: { $exists: false } },
      { $set: { originalConfigVersion: null, currentConfigVersion: null } },
    );

  // --- 4. Seed config_versions for legacy grants at 0.0.0 ---
  const grants = await db
    .collection("grants")
    .find({ version: "0.0.0" })
    .toArray();

  const ops = grants.map((grant) => ({
    updateOne: {
      filter: { grantCode: grant.code, version: "0.0.0" },
      update: {
        $setOnInsert: {
          grantCode: grant.code,
          version: "0.0.0",
          major: 0,
          minor: 0,
          patch: 0,
          status: "active",
          s3Key: null,
          s3Bucket: null,
          // Must match FetchStatus.Fetched ("fetched") so reads resolve from
          // cache and never attempt an S3 fetch for legacy rows.
          fetchStatus: "fetched",
          fetchedAt: new Date().toISOString(),
          fetchAttempts: 0,
          fetchError: null,
          lastFetchAttemptAt: null,
        },
      },
      upsert: true,
    },
  }));

  if (ops.length > 0) {
    await configVersions.bulkWrite(ops);
  }
};
