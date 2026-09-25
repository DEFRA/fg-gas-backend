const internalMessageBusTarget = "internal:message-bus";
const internalEventBusTarget = "internal:event-bus";
const claimPaymentRequestedType = /\.claim\.payment\.requested$/;

export const up = async (db) => {
  await db.collection("outbox").updateMany(
    {
      target: internalMessageBusTarget,
      "event.type": claimPaymentRequestedType,
    },
    { $set: { target: internalEventBusTarget } },
  );
};
