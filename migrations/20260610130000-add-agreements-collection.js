export const up = async (db) => {
  const agreements = db.collection("agreements");
  const agreementVersions = db.collection("agreement_versions");

  await agreements.createIndex({ agreementNumber: 1 }, { unique: true });
  await agreements.createIndex({ "identifiers.sbi": 1, agreementNumber: 1 });
  await agreements.createIndex(
    { code: 1, "items.clientRef": 1 },
    { unique: true },
  );
  await agreements.createIndex({ "items.agreementItemId": 1 });

  await agreementVersions.createIndex(
    { agreementId: 1, version: 1 },
    { unique: true },
  );
  await agreementVersions.createIndex({ agreementId: 1, version: -1 });
  await agreementVersions.createIndex({ agreementNumber: 1, version: -1 });
};
