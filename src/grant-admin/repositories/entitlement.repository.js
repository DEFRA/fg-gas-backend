import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { db } from "../../common/mongo-client.js";

export const collection = "entitlements";

const toDocument = (entitlement) => ({
  _id: entitlement.id,
  ...structuredClone(entitlement),
});

export const insertEntitlement = async (entitlement, session) => {
  try {
    await db
      .collection(collection)
      .insertOne(toDocument(entitlement), { session });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw Boom.conflict(`Entitlement with id "${entitlement.id}" exists`);
    }

    throw error;
  }
};
