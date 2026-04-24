/**
 * Relax minimums on the woodland grant.
 *
 * Changes:
 * - hectaresTenOrOverYearsOld:                exclusiveMinimum: 0 -> minimum: 0.4
 * - hectaresUnderTenYearsOld:                 exclusiveMinimum: 0 -> minimum: 0
 * - payments.agreement[].activeTierRatePence: exclusiveMinimum: 0 -> minimum: 0
 */

export const up = async (db) => {
  const base = "phases.0.questions.properties";
  const activeTierRatePence = `${base}.payments.properties.agreement.items.properties.activeTierRatePence`;

  await db.collection("grants").updateOne(
    { code: "woodland" },
    {
      $set: {
        [`${base}.hectaresTenOrOverYearsOld`]: {
          type: "number",
          minimum: 0.4,
        },
        [`${base}.hectaresUnderTenYearsOld`]: {
          type: "number",
          minimum: 0,
        },
        [activeTierRatePence]: {
          type: "number",
          minimum: 0,
        },
      },
    },
  );
};
