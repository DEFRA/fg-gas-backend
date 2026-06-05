export const up = async (db) => {
  await db.collection("outbox").updateMany(
    {
      "event.type": /agreement\.create$/,
      "event.data.clientRef": {
        $in: ["wmp-398-75z", "WMP-398-75Z", "WMP-REF-UK5", "wmp-ref-uk5"],
      },
      "event.data.code": "woodland",
    },
    {
      $set: {
        status: "RESUBMITTED",
        claimedBy: null,
        claimedAt: null,
        claimExpiresAt: null,
        completionDate: null,
        completionAttempts: 0,
        lastResubmissionDate: new Date().toISOString(),
      },
    },
  );
};
