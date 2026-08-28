import { MongoServerError } from "mongodb";
import { db } from "../../common/mongo-client.js";

export const collection = "claims";

const DUPLICATE_KEY_ERROR_CODE = 11000;

export const duplicateClientClaimRef = Symbol("duplicateClientClaimRef");

export const existsByClientClaimRef = async (
  { code, clientRef, clientClaimRef },
  session,
) => {
  const doc = await db
    .collection(collection)
    .findOne(
      { code, clientRef, clientClaimRef },
      { session, projection: { _id: 1 } },
    );
  return doc !== null;
};

export const countByClaimCode = async (
  { code, clientRef, claimCode },
  session,
) =>
  db
    .collection(collection)
    .countDocuments({ code, clientRef, claimCode }, { session });

export const insert = async (
  { code, clientRef, claimCode, clientClaimRef, metadata, claim },
  session,
) => {
  const now = new Date().toISOString();
  try {
    const result = await db.collection(collection).insertOne(
      {
        code,
        clientRef,
        claimCode,
        clientClaimRef,
        metadata,
        claim,
        createdAt: now,
        updatedAt: now,
      },
      { session },
    );
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
