/**
 * Add "farm-payments" grant definition by duplicating "frps-private-beta"
 *
 * Creates a new grant with code "farm-payments" that mirrors the current
 * state of the "frps-private-beta" grant definition. The original grant
 * is kept for backwards compatibility.
 *
 * Also updates existing applications and application_series documents to
 * use the new "farm-payments" grant code.
 */
export const up = async (db) => {
  const sourceGrant = await db
    .collection("grants")
    .findOne({ code: "frps-private-beta" });

  if (!sourceGrant) {
    throw new Error('Source grant "frps-private-beta" not found');
  }

  const { _id, ...grantWithoutId } = sourceGrant;

  await db.collection("grants").insertOne({
    ...grantWithoutId,
    code: "farm-payments",
    metadata: {
      ...grantWithoutId.metadata,
      description: "Farm payments grant",
    },
  });

  // Update existing applications to use new grant code
  await db
    .collection("applications")
    .updateMany(
      { code: "frps-private-beta" },
      { $set: { code: "farm-payments" } },
    );

  // Update existing application_series to use new grant code
  await db
    .collection("application_series")
    .updateMany(
      { code: "frps-private-beta" },
      { $set: { code: "farm-payments" } },
    );
};
