import { collection } from "../src/grants/repositories/entitlement.repository.js";

export const up = async (db) => {
  const entitlements = db.collection(collection);

  await entitlements.createIndex({ clientRef: 1, code: 1 });

  await entitlements.createIndex({ id: 1 }, { unique: true });
};
