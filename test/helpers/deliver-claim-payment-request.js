// Exercise the same Inbox boundary in unit and service-integration tests.
export const deliverClaimPaymentRequest = async ({
  props,
  ClaimPaymentRequestedEvent,
  inbox,
  Inbox,
  InboxSubscriber,
}) => {
  const event = new ClaimPaymentRequestedEvent(props);
  const { insertedId } = await inbox.insertOne({
    source: "GAS",
    type: event.type,
    event,
    messageId: event.id,
    segregationRef: event.messageGroupId,
  });
  const document = await inbox.findOne({ _id: insertedId });
  await new InboxSubscriber().handleEvent(Inbox.fromDocument(document));
  return inbox.findOne({ _id: insertedId });
};
