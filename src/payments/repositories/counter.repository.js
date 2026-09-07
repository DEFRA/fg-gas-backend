import { db } from "../../common/mongo-client.js";

export const countersCollection = "payments__counters";

export const ClaimIdCounter = "claimIds";

// Mirrors migrations/20260729120000-add-payment-collections.js. The Woodland
// cutover lowers the counter from this seed to the legacy continuation point.
export const CLAIM_ID_SEED = 9_999_999;

export const readClaimIdCounter = (session) =>
  db
    .collection(countersCollection)
    .findOne({ _id: ClaimIdCounter }, { session });

export const readPrimaryClaimIdCounter = () =>
  db
    .collection(countersCollection)
    .findOne({ _id: ClaimIdCounter }, { readPreference: "primary" });

export const setClaimIdCounterSequence = (seq, session) =>
  db
    .collection(countersCollection)
    .updateOne({ _id: ClaimIdCounter }, { $set: { seq } }, { session });

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
