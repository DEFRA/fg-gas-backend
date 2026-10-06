import { logger } from "../src/common/logger.js";

// Each field takes the type its writer stores: submission stores submittedAt as
// a Date, the model stores updatedAt as a canonical ISO string, as createdAt is.
// Null and missing stay as they are, and a value that is no instant is left as
// stored and counted, never dropped.

const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const asDate = (field) => ({
  $convert: { input: `$${field}`, to: "date", onError: null },
});

const FIELDS = [
  {
    field: "submittedAt",
    type: "Dates",
    convertible: { $type: "string" },
    canonical: { $type: "date" },
    toCanonical: asDate,
  },
  {
    field: "updatedAt",
    type: "ISO strings",
    convertible: { $type: ["string", "date"], $not: CANONICAL_ISO },
    canonical: CANONICAL_ISO,
    toCanonical: (field) => ({ $toString: asDate(field) }),
  },
];

const normalise = (applications, { field, convertible, toCanonical }) =>
  applications.updateMany({ [field]: convertible }, [
    { $set: { [field]: { $ifNull: [toCanonical(field), `$${field}`] } } },
  ]);

const countLeftAsStored = (applications, { field, canonical }) =>
  applications.countDocuments({
    [field]: { $ne: null, $not: canonical },
  });

export const up = async (db) => {
  const applications = db.collection("applications");

  for (const spec of FIELDS) {
    const { modifiedCount } = await normalise(applications, spec);
    const left = await countLeftAsStored(applications, spec);

    logger.info(
      `Normalised ${modifiedCount} application ${spec.field} values to ${spec.type}, ${left} not an instant left as stored`,
    );
  }
};
