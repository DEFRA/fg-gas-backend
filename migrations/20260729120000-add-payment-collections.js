const paymentsCollection = "payments__payments";
const countersCollection = "payments__counters";

// First GAS claim ID is R10000000; the legacy service stays below it.
const CLAIM_ID_SEED = 9999999;

export const up = async (db) => {
  const payments = db.collection(paymentsCollection);

  // One Payment per accepted Agreement Version — this index is what makes a
  // replayed or raced acceptance fail rather than pay twice.
  await payments.createIndex(
    { "source.agreementNumber": 1, "source.version": 1 },
    { unique: true },
  );
  await payments.createIndex({ paymentHubClaimId: 1 }, { unique: true });

  // Seed the claim ID counter rather than leaving the in-transaction $inc to
  // upsert it. Two concurrent transactions that both try to insert the same
  // counter _id can fail with a duplicate key error instead of a retryable
  // write conflict; seeding means the counter document always already exists.
  //
  // GAS starts at R10000000 (seeded one below, as the $inc returns the value
  // after the increment) so its claim IDs cannot collide with the legacy
  // service's while both are issuing them.
  await db
    .collection(countersCollection)
    .updateOne(
      { _id: "claimIds" },
      { $setOnInsert: { seq: CLAIM_ID_SEED } },
      { upsert: true },
    );
};
