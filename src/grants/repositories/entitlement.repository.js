import { db } from "../../common/mongo-client.js";

export const collection = "entitlements";

// Entitlements already created for an application, used to work out which
// templates still have capacity left against their maxEntitlements.
export const findExistingEntitlements = async (clientRef, code, session) =>
  db.collection(collection).find({ clientRef, code }, { session }).toArray();
