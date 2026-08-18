import { db } from "../../common/mongo-client.js";

export const collection = "entitlements";

export const findExistingEntitlements = async (clientRef, code, session) =>
  db.collection(collection).find({ clientRef, code }, { session }).toArray();
