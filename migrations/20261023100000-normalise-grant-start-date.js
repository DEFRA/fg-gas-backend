import { logger } from "../src/common/logger.js";

// metadata.startDate is an ISO string, as the published definition writes it.
// Seeded grants stored a Date, and definitions that write it as Mongo extended
// JSON were stored with the literal { $date } object, and a definition may
// write a bare four-digit year, which arrival reads as 1 January of that year;
// all become the ISO string of their instant. A value that is no instant is
// left as stored and counted.

const NOT_A_STRING = {
  "metadata.startDate": { $type: ["date", "object", "number"] },
};

const startDate = "$metadata.startDate";

const isYear = {
  $cond: [
    { $isNumber: startDate },
    {
      $and: [
        { $eq: [{ $mod: [startDate, 1] }, 0] },
        { $gte: [startDate, 1000] },
        { $lte: [startDate, 9999] },
      ],
    },
    false,
  ],
};

const instant = {
  $switch: {
    branches: [
      { case: { $eq: [{ $type: startDate }, "date"] }, then: startDate },
      {
        case: { $eq: [{ $type: startDate }, "object"] },
        then: {
          $convert: {
            input: {
              $getField: { field: { $literal: "$date" }, input: startDate },
            },
            to: "date",
            onError: null,
            onNull: null,
          },
        },
      },
      {
        case: isYear,
        then: { $dateFromParts: { year: { $toInt: startDate } } },
      },
    ],
    default: null,
  },
};

export const up = async (db) => {
  const grants = db.collection("grants");

  const normalised = await grants.updateMany(NOT_A_STRING, [
    {
      $set: {
        "metadata.startDate": { $ifNull: [{ $toString: instant }, startDate] },
      },
    },
  ]);
  const left = await grants.countDocuments(NOT_A_STRING);

  logger.info(
    `Normalised ${normalised.modifiedCount} grant start dates to ISO strings, ${left} not an instant left as stored`,
  );
};
