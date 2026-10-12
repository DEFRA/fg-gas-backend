const woodlandMigrationOperator = "woodland-migration-operator";

export const up = async (db) => {
  await db.collection("access_tokens").deleteMany({
    $or: [
      { client: woodlandMigrationOperator },
      { clientId: woodlandMigrationOperator },
    ],
  });
};
