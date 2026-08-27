const clientClaimRefIndex = "code_clientRef_clientClaimRef_unique";
const claimCodeIndex = "code_clientRef_claimCode";

export const up = async (db) => {
  const claims = db.collection("claims");

  await claims.createIndex(
    { code: 1, clientRef: 1, clientClaimRef: 1 },
    { unique: true, name: clientClaimRefIndex },
  );

  await claims.createIndex(
    { code: 1, clientRef: 1, claimCode: 1 },
    { name: claimCodeIndex },
  );
};

export const down = async (db) => {
  const claims = db.collection("claims");

  await claims.dropIndex(clientClaimRefIndex);
  await claims.dropIndex(claimCodeIndex);
};
