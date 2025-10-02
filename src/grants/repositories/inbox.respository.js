import { db } from "../../common/mongo-client.js";
import { Inbox, InboxStatus } from "../models/inbox.js";

const COLLECTION_NAME = "event_publication_inbox";

export const fetchPendingEvents = async (claimToken) => {
  await db.collection(COLLECTION_NAME).updateMany(
    {
      status: { $nin: [InboxStatus.PROCESSING, InboxStatus.COMPLETED] },
      claimToken: { $eq: null },
    },
    {
      $set: {
        status: InboxStatus.PROCESSING,
        claimToken,
        claimedAt: new Date(),
      },
    },
  );

  const documents = await db
    .collection(COLLECTION_NAME)
    .find({ claimToken })
    .toArray();

  return documents.map((doc) => Inbox.fromDocument(doc));
};

export const insertMany = async (events, session) => {
  return db.collection(COLLECTION_NAME).insertMany(
    events.map((event) => event.toDocument()),
    { session },
  );
};

export const findByMessageId = async (messageId) => {
  const doc = db.collection(COLLECTION_NAME).findOne({ messageId });
  return doc;
};

export const insertOne = async (inbox, session) => {
  return db
    .collection(COLLECTION_NAME)
    .insertOne(inbox.toDocument(), { session });
};

export const update = async (inbox) => {
  const document = inbox.toDocument();
  const { _id, ...updateDoc } = document;

  return db.collection(COLLECTION_NAME).updateOne({ _id }, { $set: updateDoc });
};
