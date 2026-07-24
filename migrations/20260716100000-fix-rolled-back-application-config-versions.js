export const up = async (db) => {
  const applications = db.collection("applications");
  const configVersions = db.collection("config_versions");

  const grantCodes = await applications.distinct("code", {
    originalConfigVersion: "0.0.0",
    currentConfigVersion: "0.0.0",
  });

  for (const grantCode of grantCodes) {
    const [highest] = await configVersions
      .find({ grantCode, status: "active" })
      .sort({ major: -1, minor: -1, patch: -1 })
      .limit(1)
      .toArray();

    if (!highest || highest.version === "0.0.0") {
      continue;
    }

    await applications.updateMany(
      {
        code: grantCode,
        originalConfigVersion: "0.0.0",
        currentConfigVersion: "0.0.0",
      },
      { $set: { currentConfigVersion: highest.version } },
    );
  }
};
