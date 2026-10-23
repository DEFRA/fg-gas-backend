import { logger } from "../src/common/logger.js";

// Every application holds `originalConfigVersion` and `currentConfigVersion`
// and no legacy `configVersion`, so the Applications list and the record page
// read the same version. An application with no version at all takes the
// versions `20260713100000-backfill-application-config-versions.js` gave one.

const legacy = {
  $or: [
    { configVersion: { $exists: true } },
    { currentConfigVersion: null, originalConfigVersion: { $ne: null } },
    { originalConfigVersion: null, currentConfigVersion: { $ne: null } },
  ],
};

const fromLegacy = [
  {
    $set: {
      originalConfigVersion: {
        $ifNull: ["$originalConfigVersion", "$configVersion", "0.0.0"],
      },
      currentConfigVersion: {
        $ifNull: [
          "$currentConfigVersion",
          { $ifNull: ["$configVersion", "$originalConfigVersion"] },
        ],
      },
    },
  },
  { $unset: "configVersion" },
];

const versionless = { currentConfigVersion: null };

const newestActiveVersion = async (configVersions, grantCode) => {
  const [newest] = await configVersions
    .find({ grantCode, status: "active" })
    .sort({ major: -1, minor: -1, patch: -1 })
    .limit(1)
    .toArray();

  return newest?.version ?? "0.0.0";
};

const giveVersions = async (applications, configVersions) => {
  let modified = 0;

  for (const code of await applications.distinct("code", versionless)) {
    const { modifiedCount } = await applications.updateMany(
      { ...versionless, code },
      {
        $set: {
          originalConfigVersion: "0.0.0",
          currentConfigVersion: await newestActiveVersion(configVersions, code),
        },
      },
    );
    modified += modifiedCount;
  }

  return modified;
};

export const up = async (db) => {
  const applications = db.collection("applications");

  const { modifiedCount } = await applications.updateMany(legacy, fromLegacy);
  const given = await giveVersions(
    applications,
    db.collection("config_versions"),
  );

  logger.info(
    `Normalised ${modifiedCount} legacy and ${given} versionless application config versions`,
  );
};
