import { db } from "../../common/mongo-client.js";

export const countersCollection = "agreements__counters";

export const ClaimIdCounter = "claimIds";

/**
 * Atomically allocates the next value for a named counter. Must be called with
 * the action's session so the allocation rolls back with the rest of the
 * transaction when the commit fails.
 */
export const allocateNextSequence = async (counterName, session) => {
  const counter = await db
    .collection(countersCollection)
    .findOneAndUpdate(
      { _id: counterName },
      { $inc: { seq: 1 } },
      { returnDocument: "after", upsert: true, session },
    );

  return counter.seq;
};
