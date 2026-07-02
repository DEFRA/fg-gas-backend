const CLIENT_REF = "wmp-2ax-726";
const CODE = "woodland";
const PHASE_CODE = "PHASE_PRE_AWARD";
const BAD_PENCE = { $gt: 238769, $lt: 238770 };
const FIXED_PENCE = 238770;
const CREATE_AGREEMENT_EVENT_TYPE =
  /^cloud\.defra\.[^.]+\.fg-gas-backend\.agreement\.create$/;

export const up = async (db) => {
  await db.collection("applications").updateOne(
    {
      clientRef: CLIENT_REF,
      code: CODE,
      "phases.answers.totalAgreementPaymentPence": BAD_PENCE,
    },
    {
      $set: {
        "phases.$[phase].answers.totalAgreementPaymentPence": FIXED_PENCE,
        "phases.$[phase].answers.payments.agreement.0.agreementTotalPence":
          FIXED_PENCE,
      },
    },
    {
      arrayFilters: [{ "phase.code": PHASE_CODE }],
    },
  );

  await db.collection("outbox").updateOne(
    {
      "event.type": CREATE_AGREEMENT_EVENT_TYPE,
      "event.data.clientRef": CLIENT_REF,
      "event.data.code": CODE,
      "event.data.answers.totalAgreementPaymentPence": BAD_PENCE,
    },
    {
      $set: {
        "event.data.answers.totalAgreementPaymentPence": FIXED_PENCE,
        "event.data.answers.payments.agreement.0.agreementTotalPence":
          FIXED_PENCE,
        status: "PUBLISHED",
        completionAttempts: 1,
        completionDate: null,
        claimedAt: null,
        claimedBy: null,
        claimExpiresAt: null,
      },
    },
  );
};
