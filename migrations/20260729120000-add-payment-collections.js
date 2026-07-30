const paymentsCollection = "payments__payments";
const countersCollection = "payments__counters";

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
  await db
    .collection(countersCollection)
    .updateOne(
      { _id: "claimIds" },
      { $setOnInsert: { seq: 0 } },
      { upsert: true },
    );
};
