/**
 * Drop all woodland applications and series.
 *
 * Pre-launch cleanup: there is no live woodland data yet, and the woodland
 * grant schema is being reshaped. Wiping any test/dev applications avoids
 * leaving documents that don't match the new schema.
 */

export const up = async (db) => {
  await db.collection("applications").deleteMany({ code: "woodland" });
  await db.collection("application_series").deleteMany({ code: "woodland" });
};
