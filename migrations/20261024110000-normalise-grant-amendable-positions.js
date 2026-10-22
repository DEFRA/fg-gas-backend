import { logger } from "../src/common/logger.js";

// amendablePositions is a list, empty when no position allows a replacement.
// Grants stored without one hold null or no key; each becomes an empty list.
// Any other value that is not a list is left as stored and counted.

// A null match also takes an array holding null, so arrays are excluded.
const NO_POSITIONS = {
  amendablePositions: { $eq: null, $not: { $type: "array" } },
};
const NOT_A_LIST = { amendablePositions: { $not: { $type: "array" } } };

export const up = async (db) => {
  const grants = db.collection("grants");
  const normalised = await grants.updateMany(NO_POSITIONS, {
    $set: { amendablePositions: [] },
  });
  const left = await grants.countDocuments(NOT_A_LIST);

  logger.info(
    `Normalised ${normalised.modifiedCount} grants with no amendable positions to an empty list, ${left} not a list left as stored`,
  );
};
