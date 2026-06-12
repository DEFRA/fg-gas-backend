export const up = async (db) => {
  const agreements = db.collection("agreements");
  const agreementVersions = db.collection("agreement_versions");

  await agreements.createIndex({ agreementNumber: 1 }, { unique: true });
  await agreements.createIndex({ sbi: 1, agreementNumber: 1 });
  await agreements.createIndex(
    { "items.clientRef": 1, "items.agreementCode": 1 },
    { unique: true },
  );
  await agreements.createIndex({ "items.agreementItemId": 1 });

  await agreementVersions.createIndex(
    { agreementId: 1, version: 1 },
    { unique: true },
  );
  await agreementVersions.createIndex({ agreementId: 1, version: -1 });
  await agreementVersions.createIndex({ agreementNumber: 1, version: -1 });
  await agreementVersions.createIndex({ sbi: 1, createdAt: -1 });
};
