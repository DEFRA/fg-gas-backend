export const up = async (db) => {
  const applications = db.collection("applications");
  const configVersions = db.collection("config_versions");

  const grantCodes = await applications.distinct("code", {
    originalConfigVersion: null,
  });

  for (const grantCode of grantCodes) {
    const [highest] = await configVersions
      .find({ grantCode, status: "active" })
      .sort({ major: -1, minor: -1, patch: -1 })
      .limit(1)
      .toArray();

    const currentVersion = highest?.version ?? "0.0.0";

    await applications.updateMany(
      { code: grantCode, originalConfigVersion: null },
      {
        $set: {
          originalConfigVersion: "0.0.0",
          currentConfigVersion: currentVersion,
        },
      },
    );
  }
};
