const legacyInternalMessageTarget = "internal:message-bus";
const legacyInternalEventTarget = "internal:event-bus";
const internalEventTarget = "internal:event";
const internalCommandTarget = "internal:command";
const paymentRequestedType = /\.(claim|agreement)\.payment\.requested$/;

export const up = async (db) => {
  const outbox = db.collection("outbox");

  await outbox.updateMany(
    {
      target: {
        $in: [legacyInternalMessageTarget, legacyInternalEventTarget],
      },
      "event.type": paymentRequestedType,
    },
    { $set: { target: internalEventTarget } },
  );

  await outbox.updateMany(
    { target: legacyInternalMessageTarget },
    { $set: { target: internalCommandTarget } },
  );
};
