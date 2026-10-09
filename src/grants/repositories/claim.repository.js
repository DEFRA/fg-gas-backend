import { db } from "../../common/mongo-client.js";
import { Claim } from "../models/claim.js";

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

// Every Claim submitted against one application, oldest first, so the Claims
// page lists them in the order they were made.
export const findByApplication = async ({ code, clientRef }, session) => {
  const docs = await db
    .collection(collection)
    .find({ code, clientRef }, { session })
    .sort({ createdAt: 1 })
    .toArray();

  return docs.map(Claim.fromDocument);
};

// Mongo assigns _id, which is the id the Claim is audited and reported under.
// The model owns every other field.
const toDocument = (claim) => ({
  code: claim.code,
  clientRef: claim.clientRef,
  claimCode: claim.claimCode,
  clientClaimRef: claim.clientClaimRef,
  entitlementId: claim.entitlementId,
  metadata: structuredClone(claim.metadata),
  claim: structuredClone(claim.claim),
  createdAt: claim.createdAt,
  updatedAt: claim.updatedAt,
});

export const insert = async (claim, session) => {
  const result = await db
    .collection(collection)
    .insertOne(toDocument(claim), { session });

  return result.insertedId;
};
