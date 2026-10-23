import { logger } from "../src/common/logger.js";

// A Grant refuses to load without an actions array. A grant stored without one
// declares no actions. Any other non-array value is left as stored and counted,
// never dropped, so the model still refuses it.

export const up = async (db) => {
  const grants = db.collection("grants");

  const { modifiedCount } = await grants.updateMany(
    { actions: { $eq: null, $not: { $type: "array" } } },
    { $set: { actions: [] } },
  );
  const left = await grants.countDocuments({
    actions: { $not: { $type: "array" } },
  });

  logger.info(
    `Normalised ${modifiedCount} grants stored without actions to no actions, ${left} with non-array actions left as stored`,
  );
};
