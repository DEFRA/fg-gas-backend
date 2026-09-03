import Boom from "@hapi/boom";
import { db } from "../../common/mongo-client.js";
import { isMongoDuplicateKeyError } from "../../common/mongo-errors.js";

export const collection = "entitlements";

const slotIndexFields = ["clientRef", "code", "claimCode", "instanceNumber"];

const isSlotConflict = (error) =>
  slotIndexFields.every((field) => error.keyPattern?.[field] === 1);

// Mongo assigns _id. The entitlement's own id is a randomUUID minted by the
// model and is the identifier callers use, so the two are kept apart: nothing
// outside this repository should depend on the database key.
const toDocument = (entitlement) => ({
  id: entitlement.id,
  clientRef: entitlement.clientRef,
  code: entitlement.code,
  claimCode: entitlement.claimCode,
  instanceNumber: entitlement.instanceNumber,
  configVersion: entitlement.configVersion,
  data: structuredClone(entitlement.data),
  createdAt: entitlement.createdAt,
});

export const insertEntitlement = async (entitlement, session) => {
  try {
    await db
      .collection(collection)
      .insertOne(toDocument(entitlement), { session });

    return true;
  } catch (error) {
    if (!isMongoDuplicateKeyError(error)) {
      throw error;
    }

    if (isSlotConflict(error)) {
      return false;
    }

    throw Boom.conflict(`Entitlement with id "${entitlement.id}" exists`);
  }
};

export const findExistingEntitlements = async (clientRef, code, session) =>
  // enitlement slots are indexed (instanceNumber) so,
  // allocation must observe a write that has just won a competing
  // slot, rather than waiting for one to catch up.
  db
    .collection(collection)
    .find({ clientRef, code }, { session, readPreference: "primary" })
    .toArray();
