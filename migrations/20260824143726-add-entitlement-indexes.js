export const up = async (db) => {
  const entitlements = db.collection("entitlements");

  await entitlements.createIndex(
    { clientRef: 1, code: 1, claimCode: 1, instanceNumber: 1 },
    { unique: true, name: "entitlement_instance_slot_unique" },
  );

  await entitlements.createIndex({ id: 1 }, { unique: true });
};
