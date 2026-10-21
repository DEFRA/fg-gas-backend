import { logger } from "../src/common/logger.js";

// metadata.startDate is an ISO string, as the published definition writes it.
// Seeded grants stored a Date, and definitions that write it as Mongo extended
// JSON were stored with the literal { $date } object; both become the ISO
// string of their instant. A value that is no instant is left as stored and
// counted.

const NOT_A_STRING = { "metadata.startDate": { $type: ["date", "object"] } };

const startDate = "$metadata.startDate";

const instant = {
  $convert: {
    input: {
      $cond: [
        { $eq: [{ $type: startDate }, "object"] },
        { $getField: { field: { $literal: "$date" }, input: startDate } },
        startDate,
      ],
    },
    to: "date",
    onError: null,
    onNull: null,
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
