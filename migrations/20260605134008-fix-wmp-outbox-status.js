export const up = async (db) => {
  await db.collection("outbox").updateMany(
    {
      "event.type": "cloud.defra.local.fg-gas-backend.agreement.create",
      "event.data.clientRef": {
        $in: ["wmp-398-75z", "WMP-REF-UK5", "wmp-ref-uk5"],
      },
    },
    {
      $set: {
        status: "PUBLISHED",
        completionDate: null,
      },
    },
  );
};
