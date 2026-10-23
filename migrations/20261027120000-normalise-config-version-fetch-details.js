import { logger } from "../src/common/logger.js";

// Every Definition File records its key, its last fetch error and its count of
// failed fetches, and every version its bucket, as GAS's writers set them. A
// file stored without one takes what GAS reads it as: no key, no error, no
// failures. A value of any other shape is left as stored and counted.

const FILE_TYPES = ["grant", "agreement", "payment"];

const fileFill = (type) => {
  const path = `definitions.${type}`;

  return {
    filter: {
      [path]: { $type: "object" },
      $or: [
        { [`${path}.s3Key`]: { $exists: false } },
        { [`${path}.fetchError`]: { $exists: false } },
        { [`${path}.fetchAttempts`]: null },
      ],
    },
    update: [
      {
        $set: {
          [`${path}.s3Key`]: { $ifNull: [`$${path}.s3Key`, null] },
          [`${path}.fetchError`]: { $ifNull: [`$${path}.fetchError`, null] },
          [`${path}.fetchAttempts`]: { $ifNull: [`$${path}.fetchAttempts`, 0] },
        },
      },
    ],
  };
};

const NULLABLE_STRING = { $not: { $type: ["string", "null"] } };

const leftShapes = [
  { s3Bucket: NULLABLE_STRING },
  ...FILE_TYPES.flatMap((type) => {
    const path = `definitions.${type}`;

    return [
      { [path]: { $type: "object" }, [`${path}.s3Key`]: NULLABLE_STRING },
      { [path]: { $type: "object" }, [`${path}.fetchError`]: NULLABLE_STRING },
      {
        [path]: { $type: "object" },
        $or: [
          { [`${path}.fetchAttempts`]: { $not: { $type: "number" } } },
          { [`${path}.fetchAttempts`]: { $lt: 0 } },
        ],
      },
    ];
  }),
];

export const up = async (db) => {
  const configVersions = db.collection("config_versions");

  const bucket = await configVersions.updateMany(
    { s3Bucket: { $exists: false } },
    { $set: { s3Bucket: null } },
  );

  let files = 0;
  for (const type of FILE_TYPES) {
    const { filter, update } = fileFill(type);
    files += (await configVersions.updateMany(filter, update)).modifiedCount;
  }

  const left = await configVersions.countDocuments({ $or: leftShapes });

  logger.info(
    `Normalised fetch details on ${files} config version files and the bucket on ${bucket.modifiedCount} config versions, ${left} versions of another shape left as stored`,
  );
};
