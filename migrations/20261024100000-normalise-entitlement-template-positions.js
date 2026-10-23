import { logger } from "../src/common/logger.js";

// A template's availableAt is a list of positions. Grants stored before the
// schema took a list hold a single position object; each becomes a
// one-position list. Any other value that is no list is left as stored and
// counted.

const availableAtType = { $type: "$$template.availableAt" };

const anyTemplate = (test) => ({
  $expr: {
    $anyElementTrue: {
      $map: {
        input: { $ifNull: ["$entitlementTemplates", []] },
        as: "template",
        in: test,
      },
    },
  },
});

const isSinglePosition = { $eq: [availableAtType, "object"] };

const SINGLE_POSITION = anyTemplate(isSinglePosition);

const NOT_A_LIST = anyTemplate({ $ne: [availableAtType, "array"] });

const normalisedTemplate = {
  $mergeObjects: [
    "$$template",
    {
      $cond: [
        isSinglePosition,
        { availableAt: ["$$template.availableAt"] },
        {},
      ],
    },
  ],
};

export const up = async (db) => {
  const grants = db.collection("grants");

  const { modifiedCount } = await grants.updateMany(SINGLE_POSITION, [
    {
      $set: {
        entitlementTemplates: {
          $map: {
            input: "$entitlementTemplates",
            as: "template",
            in: normalisedTemplate,
          },
        },
      },
    },
  ]);
  const left = await grants.countDocuments(NOT_A_LIST);

  logger.info(
    `Normalised single entitlement template positions to lists in ${modifiedCount} grants, ${left} with an availableAt that is no list left as stored`,
  );
};
