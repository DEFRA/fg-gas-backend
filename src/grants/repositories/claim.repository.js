import { db } from "../../common/mongo-client.js";

export const collection = "claims";

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

// Per-entitlement claim limits: a claim names its target, so the count is
// scoped to that entitlement rather than to every claim under the code.
export const countByEntitlement = async (
  { code, clientRef, entitlementId },
  session,
) =>
  db
    .collection(collection)
    .countDocuments({ code, clientRef, entitlementId }, { session });

// Used when listing what is claimable, where the question is how many claims
// exist under a code rather than against one entitlement.
export const countByClaimCode = async (
  { code, clientRef, claimCode },
  session,
) =>
  db
    .collection(collection)
    .countDocuments({ code, clientRef, claimCode }, { session });

export const insert = async (
  {
    code,
    clientRef,
    claimCode,
    clientClaimRef,
    entitlementId,
    metadata,
    claim,
  },
  session,
) => {
  const now = new Date().toISOString();
  const result = await db.collection(collection).insertOne(
    {
      code,
      clientRef,
      claimCode,
      clientClaimRef,
      entitlementId,
      metadata,
      claim,
      createdAt: now,
      updatedAt: now,
    },
    { session },
  );
  return result.insertedId;
};
