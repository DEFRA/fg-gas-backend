import { MongoServerError } from "mongodb";
import { db } from "../../common/mongo-client.js";

export const collection = "claims";

const DUPLICATE_KEY_ERROR_CODE = 11000;

export const duplicateClientClaimRef = Symbol("duplicateClientClaimRef");

export const findByClientClaimRef = async (
  { code, clientRef, clientClaimRef },
  session,
) =>
  db
    .collection(collection)
    .findOne({ code, clientRef, clientClaimRef }, { session });

export const countByClaimCode = async (
  { code, clientRef, claimCode },
  session,
) =>
  db
    .collection(collection)
    .countDocuments({ code, clientRef, claimCode }, { session });

export const insert = async (claim, session) => {
  try {
    const result = await db.collection(collection).insertOne(claim, {
      session,
    });
    return result.insertedId;
  } catch (error) {
    if (
      error instanceof MongoServerError &&
      error.code === DUPLICATE_KEY_ERROR_CODE
    ) {
      return duplicateClientClaimRef;
    }

    throw error;
  }
};
