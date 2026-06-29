export const up = async (db) => {
  const agreements = db.collection("agreements__agreements");
  await agreements.drop().catch(() => {});
  await agreements.createIndex({ agreementNumber: 1 }, { unique: true });
  await agreements.createIndex(
    { "items.agreementCode": 1, "items.clientRef": 1 },
    { unique: true },
  );
  await agreements.createIndex({ "identifiers.sbi": 1, agreementNumber: 1 });
  await agreements.createIndex({ "items.agreementItemId": 1 });

  const versions = db.collection("agreements__versions");
  await versions.drop().catch(() => {});
  await versions.createIndex({ agreementId: 1, version: 1 }, { unique: true });
  await versions.createIndex({ agreementId: 1, version: -1 });
  await versions.createIndex({ agreementNumber: 1, version: -1 });
};
