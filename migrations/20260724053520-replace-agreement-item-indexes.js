const agreementsCollection = "agreements__agreements";
const versionsCollection = "agreements__versions";
const namespaceNotFoundErrorCode = 26;

const dropCollection = async (collection) => {
  try {
    await collection.drop();
  } catch (error) {
    if (error.code !== namespaceNotFoundErrorCode) {
      throw error;
    }
  }
};

export const up = async (db) => {
  const agreements = db.collection(agreementsCollection);
  await dropCollection(agreements);
  await agreements.createIndex({ code: 1, clientRef: 1 }, { unique: true });
  await agreements.createIndex({
    code: 1,
    clientRef: 1,
    "identifiers.sbi": 1,
  });

  const versions = db.collection(versionsCollection);
  await dropCollection(versions);
  await versions.createIndex(
    { agreementNumber: 1, version: 1 },
    { unique: true },
  );
  await versions.createIndex(
    { agreementNumber: 1, "actionExecution.idempotencyKey": 1 },
    {
      unique: true,
      partialFilterExpression: {
        "actionExecution.idempotencyKey": { $exists: true },
      },
    },
  );
};
