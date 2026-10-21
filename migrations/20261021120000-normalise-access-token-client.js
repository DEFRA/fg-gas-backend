import { logger } from "../src/common/logger.js";

const hasIdentity = (value) => typeof value === "string" && value.trim() !== "";

export const up = async (db) => {
  const tokens = db.collection("access_tokens");

  // Snapshot the old admin guard, independently of the canonical client name.
  // Preserve explicit permission decisions on retries and for newer writers.
  await tokens.updateMany(
    { $expr: { $ne: [{ $type: "$grantAdminAccess" }, "bool"] } },
    [
      {
        $set: {
          grantAdminAccess: {
            $eq: [{ $ifNull: ["$clientId", null] }, "fg-grants-platform-admin"],
          },
        },
      },
    ],
  );

  let conflicts = 0;
  let deferred = 0;
  const records = tokens.find(
    {},
    {
      projection: {
        _id: 1,
        client: 1,
        clientId: 1,
        identityMigrationPending: 1,
      },
      readPreference: "primary",
    },
  );
  for await (const record of records) {
    if (!hasIdentity(record.clientId)) continue;
    if (record.client === record.clientId) {
      if (record.identityMigrationPending === true) {
        await tokens.updateOne(
          { _id: record._id, client: record.client, clientId: record.clientId },
          { $unset: { identityMigrationPending: "" } },
        );
      }
      continue;
    }
    const filter = {
      _id: record._id,
      clientId: record.clientId,
      client: Object.hasOwn(record, "client")
        ? { $eq: record.client }
        : { $exists: false },
    };
    // Mark before copying, so an index collision leaves the token usable under
    // its old identity. Neither token hashes nor expiry are ever rewritten.
    const marked = await tokens.updateOne(filter, {
      $set: { identityMigrationPending: true },
    });
    if (marked.matchedCount === 0) continue;
    if (hasIdentity(record.client)) {
      // client is also the seeded-token ownership key. Do not rename a
      // conflicting owner or turn token rotation into a second credential.
      conflicts++;
      continue;
    }
    try {
      await tokens.updateOne(
        { ...filter, identityMigrationPending: true },
        {
          $set: { client: record.clientId },
          $unset: { identityMigrationPending: "" },
        },
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
      deferred++;
    }
  }

  if (conflicts > 0 || deferred > 0) {
    logger.warn(
      { conflicts, deferred },
      "Access token identity normalisation deferred for conflicts or index collisions; transitional reads retained",
    );
  }
};
