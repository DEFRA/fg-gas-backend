const PENCE_TYPE_PATHS = [
  "questions.properties.totalAgreementPaymentPence.type",
  "questions.properties.payments.properties.agreement.items.properties.agreementTotalPence.type",
  "questions.properties.payments.properties.agreement.items.properties.activeTierRatePence.type",
  "questions.properties.payments.properties.agreement.items.properties.activeTierFlatRatePence.type",
];

const setPenceType = (type) =>
  Object.fromEntries(
    PENCE_TYPE_PATHS.map((path) => [`phases.$[phase].${path}`, type]),
  );

export const up = async (db) => {
  await db
    .collection("grants")
    .updateOne(
      { code: "woodland" },
      { $set: setPenceType("integer") },
      { arrayFilters: [{ "phase.code": "PHASE_PRE_AWARD" }] },
    );
};

export const down = async (db) => {
  await db
    .collection("grants")
    .updateOne(
      { code: "woodland" },
      { $set: setPenceType("number") },
      { arrayFilters: [{ "phase.code": "PHASE_PRE_AWARD" }] },
    );
};
