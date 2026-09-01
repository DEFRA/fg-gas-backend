import { db } from "../../common/mongo-client.js";

export const collection = "entitlements";

export const findExistingEntitlements = async (clientRef, code, session) =>
  // enitlement slots are indexed (instanceNumber) so,
  // allocation must observe a write that has just won a competing
  // slot, rather than waiting for one to catch up.
  db
    .collection(collection)
    .find({ clientRef, code }, { session, readPreference: "primary" })
    .toArray();
