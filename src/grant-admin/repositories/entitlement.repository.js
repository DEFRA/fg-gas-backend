import Boom from "@hapi/boom";
import { db } from "../../common/mongo-client.js";
import { isMongoDuplicateKeyError } from "../../common/mongo-errors.js";

export const collection = "entitlements";

const slotIndexFields = ["clientRef", "code", "claimCode", "instanceNumber"];

const isSlotConflict = (error) =>
  slotIndexFields.every((field) => error.keyPattern?.[field] === 1);

const toDocument = (entitlement) => ({
  _id: entitlement.id,
  ...structuredClone(entitlement),
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
