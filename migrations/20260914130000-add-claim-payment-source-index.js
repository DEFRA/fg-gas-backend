const paymentsCollection = "payments__payments";
const agreementSourceIndex = "source.agreementNumber_1_source.version_1";
const claimSourceIndex = "claim_payment_source_unique";

export const up = async (db) => {
  const payments = db.collection(paymentsCollection);

  // Agreement Payments retain their existing source contract and uniqueness,
  // but Claim sources deliberately have no `source.version`.
  await payments.dropIndex(agreementSourceIndex);
  await payments.createIndex(
    { "source.agreementNumber": 1, "source.version": 1 },
    {
      unique: true,
      partialFilterExpression: { "source.type": "agreement" },
      name: agreementSourceIndex,
    },
  );

  await payments.createIndex(
    {
      "source.code": 1,
      "source.clientRef": 1,
      "source.clientClaimRef": 1,
    },
    {
      unique: true,
      partialFilterExpression: { "source.type": "claim" },
      name: claimSourceIndex,
    },
  );
};
