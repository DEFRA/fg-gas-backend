import { logger } from "../src/common/logger.js";

// receivedAt is a canonical ISO string, as the model writes it. The seeded
// versions were stored without one, so they take the time their row was
// inserted. A value that is no instant is left as stored and counted.

const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const asDate = {
  $convert: { input: "$receivedAt", to: "date", onError: null },
};

export const up = async (db) => {
  const configVersions = db.collection("config_versions");

  const missing = await configVersions.updateMany({ receivedAt: null }, [
    { $set: { receivedAt: { $toString: { $toDate: "$_id" } } } },
  ]);
  const converted = await configVersions.updateMany(
    { receivedAt: { $type: ["string", "date"], $not: CANONICAL_ISO } },
    [
      {
        $set: {
          receivedAt: { $ifNull: [{ $toString: asDate }, "$receivedAt"] },
        },
      },
    ],
  );
  const left = await configVersions.countDocuments({
    receivedAt: { $ne: null, $not: CANONICAL_ISO },
  });

  logger.info(
    `Normalised ${missing.modifiedCount + converted.modifiedCount} config version receivedAt values to ISO strings, ${left} not an instant left as stored`,
  );
};
