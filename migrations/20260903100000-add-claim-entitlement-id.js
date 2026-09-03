// Claims now record the entitlement they were submitted against, and claim
// limits are counted per entitlement rather than per claim code. The count
// needs an index, and claims written before the field existed need backfilling
// or they would be invisible to it.
//
// The backfill is safe because of the constraint in force when those claims
// were written: a claimable template was limited to a single entitlement, so
// exactly one entitlement exists for a claim's (code, clientRef, claimCode).
// Anything ambiguous is left alone rather than guessed at.

const claimEntitlementIndex = "code_clientRef_entitlementId";

const backfillEntitlementIds = async (db) => {
  const claims = db.collection("claims");
  const entitlements = db.collection("entitlements");

  const pending = await claims
    .find({ entitlementId: { $exists: false } })
    .toArray();

  for (const claim of pending) {
    const matches = await entitlements
      .find({
        code: claim.code,
        clientRef: claim.clientRef,
        claimCode: claim.claimCode,
      })
      .toArray();

    if (matches.length !== 1) {
      continue;
    }

    await claims.updateOne(
      { _id: claim._id },
      { $set: { entitlementId: matches[0].id } },
    );
  }
};

export const up = async (db) => {
  await backfillEntitlementIds(db);

  await db
    .collection("claims")
    .createIndex(
      { code: 1, clientRef: 1, entitlementId: 1 },
      { name: claimEntitlementIndex },
    );
};
