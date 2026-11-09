import { logger } from "../src/common/logger.js";

// FGP-1582: grants-ui summed parcel areas in floating point, so some woodland
// applications hold totals such as 270.54729999999995. Those are rounded to
// the template's 4 decimal places, and each change is logged.

const CODE = "woodland";
const FIELD = "totalHectaresForSelectedParcels";
const DECIMAL_PLACES = 4;

const hectares = `$$phase.answers.${FIELD}`;
const rounded = { $round: [hectares, DECIMAL_PLACES] };
// $cond, not $and: $and may evaluate $round on a non-number and fail.
const needsRounding = {
  $cond: [{ $isNumber: hectares }, { $ne: [hectares, rounded] }, false],
};
const phasesNeedingRounding = {
  $filter: { input: "$phases", as: "phase", cond: needsRounding },
};

const AFFECTED = {
  code: CODE,
  $expr: { $gt: [{ $size: { $ifNull: [phasesNeedingRounding, []] } }, 0] },
};

const CHANGES = {
  _id: 0,
  clientRef: 1,
  changes: {
    $map: {
      input: phasesNeedingRounding,
      as: "phase",
      in: { phase: "$$phase.code", from: hectares, to: rounded },
    },
  },
};

const roundPhases = {
  $map: {
    input: "$phases",
    as: "phase",
    in: {
      $cond: [
        needsRounding,
        {
          $mergeObjects: [
            "$$phase",
            {
              answers: {
                $mergeObjects: ["$$phase.answers", { [FIELD]: rounded }],
              },
            },
          ],
        },
        "$$phase",
      ],
    },
  },
};

export const up = async (db) => {
  const applications = db.collection("applications");
  const affected = await applications
    .aggregate([
      { $match: AFFECTED },
      { $sort: { clientRef: 1 } },
      { $project: CHANGES },
    ])
    .toArray();

  const { modifiedCount } = await applications.updateMany(AFFECTED, [
    { $set: { phases: roundPhases } },
  ]);

  // One line per change, so no original value is lost to a long log line.
  for (const { clientRef, changes } of affected) {
    for (const { phase, from, to } of changes) {
      logger.info(
        `Rounding ${FIELD} on application ${clientRef} ${phase}: ${from} -> ${to}`,
      );
    }
  }
  logger.info(
    `Rounded ${FIELD} to ${DECIMAL_PLACES} decimal places on ${modifiedCount} ${CODE} applications`,
  );
};
