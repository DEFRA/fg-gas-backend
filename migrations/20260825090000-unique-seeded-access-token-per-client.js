const seededClientIndex = "seeded_client_unique";

export const up = async (db) => {
  // Guarantees one seeded access token per client, so two instances booting
  // with different hashes cannot each commit their own. Scoped to records the
  // seeder owns, leaving hand-minted tokens unconstrained.
  //
  // Nothing has ever written `seeded`, so there is nothing to clean up first.
  // Should duplicates somehow exist, this build fails and the deploy stops -
  // deleting the credentials instead would revoke clients that this boot has
  // no way to reseed, since only the one named in the secret gets rewritten.
  await db.collection("access_tokens").createIndex(
    { client: 1, seeded: 1 },
    {
      unique: true,
      partialFilterExpression: { seeded: true },
      name: seededClientIndex,
    },
  );
};

export const down = async (db) => {
  await db.collection("access_tokens").dropIndex(seededClientIndex);
};
