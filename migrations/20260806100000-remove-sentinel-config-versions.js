export const up = async (db) => {
  const applications = db.collection("applications");
  const configVersions = db.collection("config_versions");

  const grantCodes = await applications.distinct("code", {
    currentConfigVersion: "0.0.0",
  });

  for (const grantCode of grantCodes) {
    const [highest] = await configVersions
      .find({
        grantCode,
        status: "active",
        version: { $ne: "0.0.0" },
      })
      .sort({ major: -1, minor: -1, patch: -1 })
      .limit(1)
      .toArray();

    if (!highest) {
      continue;
    }

    const { modifiedCount } = await applications.updateMany(
      { code: grantCode, currentConfigVersion: "0.0.0" },
      { $set: { currentConfigVersion: highest.version } },
    );

    console.log(
      `Updated ${modifiedCount} applications for ${grantCode} to ${highest.version}`,
    );
  }

  const remainingCount = await applications.countDocuments({
    currentConfigVersion: "0.0.0",
  });

  console.log(`${remainingCount} applications remain on the legacy version`);
};
