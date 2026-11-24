// FGP-1628 stamped receipts before ordered delivery was introduced. Sequence
// those receipts ahead of future reports for their segregation reference.
export const up = async (db) => {
  await db.collection("outbox").updateMany(
    {
      eventType: "ApplicationCreatedReport",
      deliverySequence: { $exists: false },
      status: { $nin: ["COMPLETED", "PURGED"] },
    },
    { $set: { deliverySequence: -1 } },
  );
};

// The previous poller ignores deliverySequence. Keep it on the rows so an
// upgrade after rollback can resume their delivery order.
export const down = () => {};
