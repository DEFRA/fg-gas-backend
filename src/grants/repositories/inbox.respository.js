import { db } from "../../common/mongo-client.js";
import { Inbox, InboxStatus } from "../models/inbox.js";

const COLLECTION_NAME = "event_publication_inbox";
const MAX_RETRIES = 5;

export const fetchPendingEvents = async (claimToken) => {
  const omitStatuses = [
    InboxStatus.PROCESSING,
    InboxStatus.COMPLETED,
    InboxStatus.RESUBMITTED,
    InboxStatus.FAILED,
    InboxStatus.DEAD,
  ];
  await db.collection(COLLECTION_NAME).updateMany(
    {
      status: { $nin: omitStatuses },
      claimToken: { $eq: null },
      completionAttempts: { $lte: MAX_RETRIES },
    },
    {
      $set: {
        status: InboxStatus.PROCESSING,
        claimToken,
        claimedAt: new Date(),
        claimExpiresAt: new Date(Date.now() + 300000)// 5 minutes
      },
    },
  );

  const documents = await db
    .collection(COLLECTION_NAME)
    .find({ claimToken })
    .toArray();

  return documents.map((doc) => Inbox.fromDocument(doc));
};

export const processExpiredEvents = async () => {
  await db.collection[COLLECTION_NAME].updateMany({
    claimExpiresAt: { lt: new Date() },
  }, {
    $set: {
      status: InboxStatus.RESUBMITTED,
      claimToken: null,
      claimedAt: null,
      claimExpiresAt: null,
      hostname: null
    }
  });
}

// Move events that have been retried to dead status
export const updateDeadEvents = async () => {
  const results = await db
    .collection(COLLECTION_NAME)
    .updateMany(
      { completionAttempts: { $gte: MAX_RETRIES } },
      { $set: { status: InboxStatus.DEAD, claimToken: null, claimedAt: null, claimExpiresAt: null, hostname: null } },
    );
  return results;
};

// Move failed events to resubmitted status
export const updateFailedEvents = async () => {
  const results = await db.collection(COLLECTION_NAME).updateMany(
    {
      status: InboxStatus.FAILED,
    },
    {
      $set: { status: InboxStatus.RESUBMITTED, claimToken: null, claimedAt: null, claimExpiresAt: null, hostname: null },
    },
  );
  return results;
};

// Move resubmitted events to published status
export const updateResubmittedEvents = async () => {
  const results = await db.collection(COLLECTION_NAME).updateMany(
    {
      status: InboxStatus.RESUBMITTED,
    },
    {
      $set: { status: InboxStatus.PUBLISHED, claimToken: null, claimedAt: null, claimExpiresAt: null, hostname: null },
      $inc: { completionAttempts: 1 },
    },
  );
  return results;
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
