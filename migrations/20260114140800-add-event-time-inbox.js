export const up = async (db) => {
  const collection = db.collection("inbox");

  await collection.createIndex({
    status: 1,
    claimedBy: 1,
    completionAttempts: 1,
    eventTime: 1,
  });

  await collection.updateMany({}, [
    {
      $set: {
        eventTime: "$event.time",
      },
    },
  ]);
};
