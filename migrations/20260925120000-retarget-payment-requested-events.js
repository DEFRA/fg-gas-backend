const internalCommandTarget = "internal:message-bus";
const legacyInternalEventTarget = "internal:event-bus";
const internalEventTarget = "internal:event";
const paymentRequestedType = /\.(claim|agreement)\.payment\.requested$/;

export const up = async (db) => {
  await db.collection("outbox").updateMany(
    {
      target: {
        $in: [internalCommandTarget, legacyInternalEventTarget],
      },
      "event.type": paymentRequestedType,
    },
    { $set: { target: internalEventTarget } },
  );
};
